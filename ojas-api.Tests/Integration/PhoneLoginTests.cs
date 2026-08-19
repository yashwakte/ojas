using System.Net;
using System.Net.Http.Json;
using OjasApi.Models;
using Shouldly;

namespace OjasApi.Tests.Integration;

/// <summary>
/// Customer sign-in with a phone number instead of email+password. The factory registers
/// FakePhoneOtpSender (IsConfigured = true, no real MSG91 call), so this suite exercises the
/// "MSG91 is live" path end to end - the real, currently-unconfigured 503 branch is covered by
/// AuthControllerTests instead, where the mock's default state matches production today.
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

    private static async Task<string?> RequestPhoneLoginCodeAsync(HttpClient client, string phone)
    {
        var response = await client.PostAsJsonAsync(
            "/api/auth/phone-login/send-otp", new PhoneLoginRequest(phone, "test-turnstile-token"));
        response.StatusCode.ShouldBe(HttpStatusCode.OK);

        var body = await response.Content.ReadFromJsonAsync<PhoneLoginDevResponse>();
        return body!.DevCode;
    }

    [Fact]
    public async Task ARegisteredCustomer_CanSignIn_WithJustTheirPhoneNumber()
    {
        using var client = _factory.CreateClient();
        var suffix = Guid.NewGuid().ToString("N")[..8];
        var phone = $"9{suffix.PadRight(9, '0')}";
        var (auth, _) = await client.RegisterAsync(phone: phone);

        using var loginClient = _factory.CreateClient();
        var code = await RequestPhoneLoginCodeAsync(loginClient, phone);
        code.ShouldNotBeNull();

        var response = await loginClient.PostAsJsonAsync(
            "/api/auth/phone-login/verify", new PhoneLoginVerifyRequest(phone, code!));

        response.StatusCode.ShouldBe(HttpStatusCode.OK);
        var session = await response.Content.ReadFromJsonAsync<AuthResponse>();
        session!.Email.ShouldBe(auth.Email);
        session.CsrfToken.ShouldNotBeNullOrWhiteSpace();
    }

    [Fact]
    public async Task AnUnregisteredNumber_GetsTheGenericResponse_WithNoCode()
    {
        using var client = _factory.CreateClient();

        var response = await client.PostAsJsonAsync(
            "/api/auth/phone-login/send-otp",
            new PhoneLoginRequest($"9{Guid.NewGuid():N}".Substring(0, 10), "test-turnstile-token"));

        response.StatusCode.ShouldBe(HttpStatusCode.OK);
        var body = await response.Content.ReadFromJsonAsync<PhoneLoginDevResponse>();
        body!.DevCode.ShouldBeNull();
    }

    [Fact]
    public async Task StaffPhoneNumbers_CannotSignIn_ThroughThePhoneLoginPath()
    {
        // Staff have phone numbers on file too, but phone login has no device concept - allowing
        // it here would let anyone with the number bypass the single-device restriction entirely.
        using var client = _factory.CreateClient();
        var (_, phone) = await SeedStaffWithPhoneAsync();

        var code = await RequestPhoneLoginCodeAsync(client, phone);

        // No code was ever generated for a staff number, so this is silently a no-op - the same
        // shape as an unregistered number, which is the point: it must not be distinguishable.
        code.ShouldBeNull();
    }

    [Fact]
    public async Task AnUnverifiedCustomer_CannotSignIn_ThroughThePhoneLoginPath()
    {
        // Registered but never completed email verification - a phone-login code must not hand
        // out a session to an account that never finished signing up.
        using var client = _factory.CreateClient();
        var suffix = Guid.NewGuid().ToString("N")[..8];
        var phone = $"9{suffix.PadRight(9, '0')}";

        await _factory.SeedAsync(async db => await db.Users.InsertOneAsync(new User
        {
            FullName = "Never Verified",
            Email = $"unverified.{suffix}@example.com",
            Phone = phone,
            PasswordHash = BCrypt.Net.BCrypt.HashPassword("Passw0rd123!"),
            Role = UserRoles.Customer,
            IsEmailVerified = false,
        }));

        var code = await RequestPhoneLoginCodeAsync(client, phone);

        code.ShouldBeNull();
    }

    [Fact]
    public async Task AWrongCode_IsRejected_AndIssuesNoSession()
    {
        using var client = _factory.CreateClient();
        var suffix = Guid.NewGuid().ToString("N")[..8];
        var phone = $"9{suffix.PadRight(9, '0')}";
        await client.RegisterAsync(phone: phone);
        await RequestPhoneLoginCodeAsync(client, phone);

        var response = await client.PostAsJsonAsync(
            "/api/auth/phone-login/verify", new PhoneLoginVerifyRequest(phone, "000000"));

        response.StatusCode.ShouldBe(HttpStatusCode.BadRequest);
    }

    [Fact]
    public async Task ACodeCannotBeRedeemedTwice()
    {
        using var client = _factory.CreateClient();
        var suffix = Guid.NewGuid().ToString("N")[..8];
        var phone = $"9{suffix.PadRight(9, '0')}";
        await client.RegisterAsync(phone: phone);
        var code = await RequestPhoneLoginCodeAsync(client, phone);

        var first = await client.PostAsJsonAsync(
            "/api/auth/phone-login/verify", new PhoneLoginVerifyRequest(phone, code!));
        first.StatusCode.ShouldBe(HttpStatusCode.OK);

        var replay = await client.PostAsJsonAsync(
            "/api/auth/phone-login/verify", new PhoneLoginVerifyRequest(phone, code!));
        replay.StatusCode.ShouldBe(HttpStatusCode.BadRequest);
    }

    [Fact]
    public async Task PhoneLogin_IsRejected_WithoutACorrectTurnstileToken()
    {
        using var client = _factory.CreateClient();
        var suffix = Guid.NewGuid().ToString("N")[..8];
        var phone = $"9{suffix.PadRight(9, '0')}";
        await client.RegisterAsync(phone: phone);

        var response = await client.PostAsJsonAsync(
            "/api/auth/phone-login/send-otp", new PhoneLoginRequest(phone, ""));

        // Missing token fails model validation ([Required]) before Turnstile is even checked.
        response.StatusCode.ShouldBe(HttpStatusCode.BadRequest);
    }

    private async Task<(string Email, string Phone)> SeedStaffWithPhoneAsync()
    {
        var suffix = Guid.NewGuid().ToString("N")[..8];
        var email = $"staff.{suffix}@example.com";
        var phone = $"8{suffix.PadRight(9, '0')}";

        await _factory.SeedAsync(async db => await db.Users.InsertOneAsync(new User
        {
            FullName = "Test Delivery Partner",
            Email = email,
            Phone = phone,
            PasswordHash = BCrypt.Net.BCrypt.HashPassword("Passw0rd123!"),
            Role = UserRoles.Delivery,
            IsEmailVerified = true,
            IsPhoneVerified = true,
        }));

        return (email, phone);
    }

    private record PhoneLoginDevResponse(string Message, string? DevCode);
}
