using System.Net;
using System.Text.Json.Serialization;
using System.Net.Http.Json;
using OjasApi.Models;
using Shouldly;

namespace OjasApi.Tests.Integration;

/// <summary>
/// Customer sign-in with a phone number instead of email+password, via the MSG91 OTP Widget: the
/// browser sends and collects the code directly against MSG91 (never modelled here - there is no
/// backend send step left to test), and hands the resulting access token to
/// /phone-login/verify, which Msg91WidgetVerifier checks against MSG91 and binds to the phone in
/// the request. FakeMsg91WidgetHandler.IssueToken stands in for a customer having completed that
/// widget flow for a given number.
///
/// /phone-login/send-otp (the pre-widget raw-code flow) still exists and still works - kept as a
/// fallback, not deleted - but is no longer called by the frontend, so it is not exercised here;
/// its own behaviour is unchanged and still covered by AuthControllerTests.
/// </summary>
[Collection(MongoCollectionFixture.Name)]
public class PhoneLoginTests : IDisposable
{
    private readonly OjasApiFactory _factory;

    public PhoneLoginTests(MongoRunnerFixture mongo)
    {
        _factory = new OjasApiFactory(mongo);
    }

    public void Dispose() => _factory.Dispose();

    /// <summary>Guid.ToString("N") is hex, not decimal - it can contain letters (a-f), which
    /// Msg91WidgetVerifier's country-code-agnostic phone comparison strips out along with any
    /// other non-digit character. A real phone number never contains letters, so the fix belongs
    /// here (generate digits only) rather than in the verifier.</summary>
    private static string GeneratePhone(string leadingDigit = "9")
    {
        var digits = Math.Abs(Guid.NewGuid().GetHashCode()).ToString().PadLeft(9, '0')[..9];
        return $"{leadingDigit}{digits}";
    }

    [Fact]
    public async Task ARegisteredCustomer_CanSignIn_WithAVerifiedWidgetToken()
    {
        using var client = _factory.CreateClient();
        var phone = GeneratePhone();
        var (auth, _) = await client.RegisterAsync(phone: phone);

        var token = _factory.Msg91Widget.IssueToken(phone);
        var response = await client.PostAsJsonAsync(
            "/api/auth/phone-login/verify", new PhoneLoginVerifyRequest(phone, token));

        response.StatusCode.ShouldBe(HttpStatusCode.OK);
        var session = await response.Content.ReadFromJsonAsync<AuthResponse>();
        session!.Email.ShouldBe(auth.Email);
        session.CsrfToken.ShouldNotBeNullOrWhiteSpace();
    }

    [Fact]
    public async Task AToken_CannotSignInAsADifferentPhone_ThanItWasIssuedFor()
    {
        // The security-critical check: a token proves *some* number was verified, not that it was
        // the number in this request. Without binding these, verifying your own phone and
        // replaying the token against someone else's would sign you into their account.
        using var client = _factory.CreateClient();
        var ownPhone = GeneratePhone();
        var victimPhone = GeneratePhone();
        await client.RegisterAsync(phone: victimPhone);

        var token = _factory.Msg91Widget.IssueToken(ownPhone);
        var response = await client.PostAsJsonAsync(
            "/api/auth/phone-login/verify", new PhoneLoginVerifyRequest(victimPhone, token));

        response.StatusCode.ShouldBe(HttpStatusCode.BadRequest);
    }

    [Fact]
    public async Task StaffPhoneNumbers_CannotSignIn_EvenWithAVerifiedWidgetToken()
    {
        // Staff have phone numbers on file too, but phone login has no device concept - allowing
        // it here would let anyone with the number bypass the single-device restriction entirely.
        // This has to hold at verify time now, not only at a send-time gate the widget bypasses.
        using var client = _factory.CreateClient();
        var phone = GeneratePhone("8");
        await SeedStaffWithPhoneAsync(phone);

        var token = _factory.Msg91Widget.IssueToken(phone);
        var response = await client.PostAsJsonAsync(
            "/api/auth/phone-login/verify", new PhoneLoginVerifyRequest(phone, token));

        response.StatusCode.ShouldBe(HttpStatusCode.BadRequest);
    }

    [Fact]
    public async Task AnUnverifiedCustomer_CannotSignIn_EvenWithAVerifiedWidgetToken()
    {
        // Registered but never completed email verification - a phone-login token must not hand
        // out a session to an account that never finished signing up, regardless of what MSG91
        // itself confirmed about the phone number.
        using var client = _factory.CreateClient();
        var phone = GeneratePhone();
        var suffix = Guid.NewGuid().ToString("N")[..8];

        await _factory.SeedAsync(async db => await db.Users.InsertOneAsync(new User
        {
            FullName = "Never Verified",
            Email = $"unverified.{suffix}@example.com",
            Phone = phone,
            PasswordHash = BCrypt.Net.BCrypt.HashPassword("Passw0rd123!"),
            Role = UserRoles.Customer,
            IsEmailVerified = false,
        }));

        var token = _factory.Msg91Widget.IssueToken(phone);
        var response = await client.PostAsJsonAsync(
            "/api/auth/phone-login/verify", new PhoneLoginVerifyRequest(phone, token));

        response.StatusCode.ShouldBe(HttpStatusCode.BadRequest);
    }

    [Fact]
    public async Task AnUnrecognisedToken_IsRejected_AndIssuesNoSession()
    {
        using var client = _factory.CreateClient();
        var phone = GeneratePhone();
        await client.RegisterAsync(phone: phone);

        var response = await client.PostAsJsonAsync(
            "/api/auth/phone-login/verify", new PhoneLoginVerifyRequest(phone, "never-issued-token"));

        response.StatusCode.ShouldBe(HttpStatusCode.BadRequest);
    }

    [Fact]
    public async Task ATokenCannotBeRedeemedTwice()
    {
        using var client = _factory.CreateClient();
        var phone = GeneratePhone();
        await client.RegisterAsync(phone: phone);
        var token = _factory.Msg91Widget.IssueToken(phone);

        var first = await client.PostAsJsonAsync(
            "/api/auth/phone-login/verify", new PhoneLoginVerifyRequest(phone, token));
        first.StatusCode.ShouldBe(HttpStatusCode.OK);

        var replay = await client.PostAsJsonAsync(
            "/api/auth/phone-login/verify", new PhoneLoginVerifyRequest(phone, token));
        replay.StatusCode.ShouldBe(HttpStatusCode.BadRequest);
    }

    // ---------- phone-login/exists (MSG91's "User Existence Validation" hook) ----------

    [Fact]
    public async Task Exists_ReportsTrue_ForARegisteredVerifiedCustomer()
    {
        using var client = _factory.CreateClient();
        var phone = GeneratePhone();
        await client.RegisterAsync(phone: phone);

        var response = await client.GetAsync($"/api/auth/phone-login/exists?identifier={phone}");

        response.StatusCode.ShouldBe(HttpStatusCode.OK);
        var body = await response.Content.ReadFromJsonAsync<UserExistenceResponse>();
        body!.UserFound.ShouldBeTrue();
        body.Identifier.ShouldBe(phone);
    }

    [Fact]
    public async Task Exists_ReportsFalse_ForAnUnregisteredNumber()
    {
        using var client = _factory.CreateClient();

        var response = await client.GetAsync($"/api/auth/phone-login/exists?identifier={GeneratePhone()}");

        response.StatusCode.ShouldBe(HttpStatusCode.OK);
        var body = await response.Content.ReadFromJsonAsync<UserExistenceResponse>();
        body!.UserFound.ShouldBeFalse();
    }

    [Fact]
    public async Task Exists_ReportsFalse_ForAStaffPhoneNumber()
    {
        using var client = _factory.CreateClient();
        var phone = GeneratePhone("8");
        await SeedStaffWithPhoneAsync(phone);

        var response = await client.GetAsync($"/api/auth/phone-login/exists?identifier={phone}");

        var body = await response.Content.ReadFromJsonAsync<UserExistenceResponse>();
        body!.UserFound.ShouldBeFalse();
    }

    private async Task SeedStaffWithPhoneAsync(string phone)
    {
        var suffix = Guid.NewGuid().ToString("N")[..8];

        await _factory.SeedAsync(async db => await db.Users.InsertOneAsync(new User
        {
            FullName = "Test Delivery Partner",
            Email = $"staff.{suffix}@example.com",
            Phone = phone,
            PasswordHash = BCrypt.Net.BCrypt.HashPassword("Passw0rd123!"),
            Role = UserRoles.Delivery,
            IsEmailVerified = true,
            IsPhoneVerified = true,
        }));
    }

    /// <summary>MSG91's required contract is snake_case (user_found), not the .NET default -
    /// System.Text.Json does not bridge that gap on its own, so the property names have to be
    /// pinned explicitly rather than relying on case-insensitive matching (which only handles
    /// case, not the underscore).</summary>
    private record UserExistenceResponse(
        [property: JsonPropertyName("user_found")] bool UserFound,
        [property: JsonPropertyName("identifier")] string Identifier);
}
