using System.Net;
using System.Net.Http.Json;
using MongoDB.Driver;
using OjasApi.Models;
using OjasApi.Services;
using OjasApi.Tests.TestHelpers;
using Shouldly;

namespace OjasApi.Tests.Integration;

/// <summary>
/// Signing in with a mobile number alone - step one of checkout for a customer who is not signed
/// in. A verified number opens the account it belongs to or creates one; nothing else about the
/// request is trusted to pick the account.
/// </summary>
[Collection(MongoCollectionFixture.Name)]
public class PhoneSignInTests : IDisposable
{
    private readonly OjasApiFactory _factory;

    public PhoneSignInTests(MongoRunnerFixture mongo) => _factory = new OjasApiFactory(mongo);
    public void Dispose() => _factory.Dispose();

    private static string GeneratePhone(string leadingDigit = "9") =>
        $"{leadingDigit}{Math.Abs(Guid.NewGuid().GetHashCode()).ToString().PadLeft(9, '0')[..9]}";

    private static string NewEmail() => $"guest.{Guid.NewGuid().ToString("N")[..8]}@example.com";

    private const string CheckoutPassword = "Checkout123!";

    /// <summary>A new number needs a password, as the registration page does, so one is sent unless
    /// a test says otherwise. For a number that already has an account it is ignored.</summary>
    private static Task<HttpResponseMessage> SignInAsync(
        HttpClient client, string phone, string? token = null, string? fullName = null, string? email = null,
        string? password = CheckoutPassword) =>
        client.PostAsJsonAsync(
            "/api/auth/phone-signin",
            new PhoneSignInRequest(phone, token ?? FakeMsg91WidgetHandler.TokenFor(phone), fullName, email, password));

    /// <summary>The follow-up for a proved new number: the details, no widget token - the sign-up
    /// ticket cookie the client is holding stands in for the code.</summary>
    private static Task<HttpResponseMessage> CompleteAsync(
        HttpClient client, string phone, string? fullName = "Sneha", string? email = null, string? password = CheckoutPassword) =>
        client.PostAsJsonAsync(
            "/api/auth/phone-signin",
            new PhoneSignInRequest(phone, null, fullName, email ?? NewEmail(), password));

        private async Task<User> FindUserAsync(string phone)
    {
        User? user = null;
        await _factory.SeedAsync(async db =>
            user = await db.Users.Find(u => u.Phone == phone).FirstOrDefaultAsync());
        return user!;
    }

    [Fact]
    public async Task ANewNumber_CreatesAnAccountWithItsPassword_AndAnUnverifiedEmail()
    {
        using var client = _factory.CreateClient();
        var phone = GeneratePhone();
        var email = NewEmail();

        var response = await SignInAsync(client, phone, fullName: "Sneha Dhoran", email: email);

        response.StatusCode.ShouldBe(HttpStatusCode.OK);
        var body = await response.Content.ReadFromJsonAsync<PhoneSignInResponse>();
        body!.IsNewAccount.ShouldBeTrue();
        body.EmailVerified.ShouldBeFalse();
        body.Session.FullName.ShouldBe("Sneha Dhoran");
        body.Session.Email.ShouldBe(email);
        body.Session.CsrfToken.ShouldNotBeNullOrEmpty();

        var user = await FindUserAsync(phone);
        user.IsPhoneVerified.ShouldBeTrue();
        user.IsEmailVerified.ShouldBeFalse();
        user.Role.ShouldBe(UserRoles.Customer);

        // The session is real: the cookie that came back opens the account's own profile.
        var profile = await client.GetAsync("/api/user/profile");
        profile.StatusCode.ShouldBe(HttpStatusCode.OK);

        // And next time they sign in with the password - no text code needed.
        using var nextVisit = _factory.CreateClient();
        var login = await nextVisit.PostAsJsonAsync(
            "/api/auth/login", new LoginRequest(phone, CheckoutPassword, "test-turnstile-token"));
        login.StatusCode.ShouldBe(HttpStatusCode.OK);
    }

    [Theory]
    [InlineData(null)]
    [InlineData("short")]
    public async Task ANewNumber_WithoutAProperPassword_IsRefused_AndFixedWithoutASecondCode(string? password)
    {
        using var client = _factory.CreateClient();
        var phone = GeneratePhone();

        var refused = await SignInAsync(client, phone, fullName: "Sneha", email: NewEmail(), password: password);
        refused.StatusCode.ShouldBe(HttpStatusCode.BadRequest);
        (await FindUserAsync(phone)).ShouldBeNull();

        (await CompleteAsync(client, phone)).StatusCode.ShouldBe(HttpStatusCode.OK);
        (await FindUserAsync(phone)).ShouldNotBeNull();
    }

    [Fact]
    public async Task ANumberWithAnAccount_OpensThatAccount_AndIgnoresTheTypedDetails()
    {
        using var registering = _factory.CreateClient();
        var phone = GeneratePhone();
        var (existing, _) = await registering.RegisterAsync(fullName: "Priya Sharma", phone: phone);

        using var client = _factory.CreateClient();
        var response = await SignInAsync(
            client, phone, token: _factory.Msg91Widget.IssueToken(phone), fullName: "Someone Else", email: NewEmail());

        response.StatusCode.ShouldBe(HttpStatusCode.OK);
        var body = await response.Content.ReadFromJsonAsync<PhoneSignInResponse>();
        body!.IsNewAccount.ShouldBeFalse();
        body.Session.Id.ShouldBe(existing.Id);
        body.Session.FullName.ShouldBe("Priya Sharma");
        body.Session.Email.ShouldBe(existing.Email);
    }

    /// <summary>The checkout flow as the page now runs it: the number alone, proved by its code;
    /// then, because it is new, the details - with no second text code.</summary>
    [Fact]
    public async Task ANewNumber_ProvedAlone_IsAskedForDetails_ThenCreatedWithoutASecondCode()
    {
        using var client = _factory.CreateClient();
        var phone = GeneratePhone();

        var asked = await SignInAsync(client, phone, password: null);
        asked.StatusCode.ShouldBe(HttpStatusCode.BadRequest);
        (await asked.Content.ReadAsStringAsync()).ShouldContain("needsDetails");

        var created = await CompleteAsync(client, phone, fullName: "Sneha Dhoran");
        created.StatusCode.ShouldBe(HttpStatusCode.OK);
        (await created.Content.ReadFromJsonAsync<PhoneSignInResponse>())!.IsNewAccount.ShouldBeTrue();

        // The ticket is spent with the account it opened; it cannot open a second one.
        var again = await CompleteAsync(client, phone);
        again.StatusCode.ShouldBe(HttpStatusCode.BadRequest);
        (await again.Content.ReadAsStringAsync()).ShouldContain("verifyAgain");
    }

    /// <summary>The enumeration hole this flow closes: before the number is proved, a number with
    /// an account, a staff number and a new number must all be answered identically.</summary>
    [Fact]
    public async Task BeforeTheNumberIsProved_NothingSaysWhetherItHasAnAccount()
    {
        using var registering = _factory.CreateClient();
        var customerPhone = GeneratePhone();
        await registering.RegisterAsync(phone: customerPhone);
        var staffPhone = GeneratePhone("8");
        await _factory.SeedAsync(db => db.Users.InsertOneAsync(new User
        {
            FullName = "Delivery Partner", Email = NewEmail(), Phone = staffPhone,
            PasswordHash = "x", Role = UserRoles.Delivery, IsEmailVerified = true, IsPhoneVerified = true,
        }));
        var newPhone = GeneratePhone();

        var bodies = new List<string>();
        foreach (var phone in new[] { customerPhone, staffPhone, newPhone })
        {
            using var client = _factory.CreateClient();
            var response = await SignInAsync(client, phone, token: "not-a-real-token", password: null);
            response.StatusCode.ShouldBe(HttpStatusCode.BadRequest);
            response.Headers.Contains("Set-Cookie").ShouldBeFalse();
            bodies.Add(await response.Content.ReadAsStringAsync());

            // And with no token at all, the same for every number too.
            using var noToken = _factory.CreateClient();
            (await CompleteAsync(noToken, phone)).StatusCode.ShouldBe(HttpStatusCode.BadRequest);
        }
        bodies.Distinct().Count().ShouldBe(1);
    }

    [Fact]
    public async Task ASignUpTicket_IsBoundToTheNumberItWasIssuedFor()
    {
        using var client = _factory.CreateClient();
        var proved = GeneratePhone();
        (await SignInAsync(client, proved, password: null)).StatusCode.ShouldBe(HttpStatusCode.BadRequest);

        var someoneElse = GeneratePhone();
        (await CompleteAsync(client, someoneElse)).StatusCode.ShouldBe(HttpStatusCode.BadRequest);
        (await FindUserAsync(someoneElse)).ShouldBeNull();
    }

    [Fact]
    public async Task ASignUpTicket_CannotBeUsedToTestEmailsForever()
    {
        using var registering = _factory.CreateClient();
        var takenEmail = NewEmail();
        await registering.RegisterAsync(email: takenEmail);

        using var client = _factory.CreateClient();
        var phone = GeneratePhone();
        (await SignInAsync(client, phone, password: null)).StatusCode.ShouldBe(HttpStatusCode.BadRequest);

        for (var i = 0; i < PhoneSignupTicket.MaxUses; i++)
            (await CompleteAsync(client, phone, email: takenEmail)).StatusCode.ShouldBe(HttpStatusCode.Conflict);

        // Uses exhausted: even a perfectly good email now needs the number proved again.
        var exhausted = await CompleteAsync(client, phone);
        exhausted.StatusCode.ShouldBe(HttpStatusCode.BadRequest);
        (await exhausted.Content.ReadAsStringAsync()).ShouldContain("verifyAgain");
    }

    [Fact]
    public async Task AnEmailOnAnotherAccount_IsRefusedWithAConflict()
    {
        using var registering = _factory.CreateClient();
        var takenEmail = NewEmail();
        await registering.RegisterAsync(email: takenEmail);

        using var client = _factory.CreateClient();
        var phone = GeneratePhone();
        var response = await SignInAsync(client, phone, fullName: "Sneha", email: takenEmail.ToUpperInvariant());

        response.StatusCode.ShouldBe(HttpStatusCode.Conflict);
        (await FindUserAsync(phone)).ShouldBeNull();
    }

    [Fact]
    public async Task AStaffNumber_CanNeverSignInByCode()
    {
        var phone = GeneratePhone("8");
        await _factory.SeedAsync(db => db.Users.InsertOneAsync(new User
        {
            FullName = "Delivery Partner",
            Email = NewEmail(),
            Phone = phone,
            PasswordHash = BCrypt.Net.BCrypt.HashPassword("Passw0rd123!"),
            Role = UserRoles.Delivery,
            IsEmailVerified = true,
            IsPhoneVerified = true,
        }));

        using var client = _factory.CreateClient();
        var response = await SignInAsync(client, phone);

        response.StatusCode.ShouldBe(HttpStatusCode.Forbidden);
    }

    [Fact]
    public async Task AToken_CannotBeRedeemedTwice_EvenIfMsg91WouldAcceptIt()
    {
        var phone = GeneratePhone();
        var token = _factory.Msg91Widget.IssueReusableToken(phone);

        using var first = _factory.CreateClient();
        (await SignInAsync(first, phone, token: token, fullName: "Sneha", email: NewEmail()))
            .StatusCode.ShouldBe(HttpStatusCode.OK);

        using var second = _factory.CreateClient();
        (await SignInAsync(second, phone, token: token))
            .StatusCode.ShouldBe(HttpStatusCode.BadRequest);
    }

    [Fact]
    public async Task AWrongNumberForTheToken_IsRefused()
    {
        using var client = _factory.CreateClient();
        var phone = GeneratePhone();
        var someoneElses = FakeMsg91WidgetHandler.TokenFor(GeneratePhone());

        var response = await SignInAsync(client, phone, token: someoneElses, fullName: "Sneha", email: NewEmail());

        response.StatusCode.ShouldBe(HttpStatusCode.BadRequest);
        (await FindUserAsync(phone)).ShouldBeNull();
    }

    /// <summary>Somebody registers a stranger's number with their own email and password and never
    /// verifies it. When the real owner verifies the number, the account becomes theirs - their
    /// password works and the earlier person's stops working.</summary>
    [Fact]
    public async Task AnAbandonedRegistration_IsClaimedByWhoeverProvesTheNumber()
    {
        using var squatter = _factory.CreateClient();
        var phone = GeneratePhone();
        var squatterEmail = NewEmail();
        (await squatter.PostAsJsonAsync("/api/auth/register", new RegisterRequest(
            "Squatter", squatterEmail, phone, "Passw0rd123!", "test-turnstile-token")))
            .EnsureSuccessStatusCode();

        using var owner = _factory.CreateClient();
        var ownerEmail = NewEmail();
        var response = await SignInAsync(owner, phone, fullName: "Real Owner", email: ownerEmail);

        response.StatusCode.ShouldBe(HttpStatusCode.OK);
        var body = await response.Content.ReadFromJsonAsync<PhoneSignInResponse>();
        body!.Session.FullName.ShouldBe("Real Owner");
        body.Session.Email.ShouldBe(ownerEmail);

        var login = await squatter.PostAsJsonAsync(
            "/api/auth/login", new LoginRequest(squatterEmail, "Passw0rd123!", "test-turnstile-token"));
        login.StatusCode.ShouldBe(HttpStatusCode.Unauthorized);
        var loginByPhone = await squatter.PostAsJsonAsync(
            "/api/auth/login", new LoginRequest(phone, "Passw0rd123!", "test-turnstile-token"));
        loginByPhone.StatusCode.ShouldBe(HttpStatusCode.Unauthorized);

        var ownerLogin = await owner.PostAsJsonAsync(
            "/api/auth/login", new LoginRequest(phone, CheckoutPassword, "test-turnstile-token"));
        ownerLogin.StatusCode.ShouldBe(HttpStatusCode.OK);
    }

    /// <summary>A guest's browser can still carry an earlier session's cookie that the page no
    /// longer knows about. Signing in is a login like any other and must not be refused for
    /// arriving without that old session's CSRF token.</summary>
    [Fact]
    public async Task ABrowserStillHoldingAnOldSession_CanStillSignInByCode()
    {
        using var client = _factory.CreateClient();
        await client.RegisterAsync();

        var response = await SignInAsync(client, GeneratePhone(), fullName: "Sneha", email: NewEmail());

        response.StatusCode.ShouldBe(HttpStatusCode.OK);
    }

    /// <summary>MSG91 cannot send from localhost, so a developer's machine signs in with the local
    /// test token. The test host runs in Development, which is the only place it is honoured - and
    /// each one carries its own suffix, so testing the same number twice still works.</summary>
    [Fact]
    public async Task TheLocalTestToken_SignsInInDevelopment_AndCanBeUsedAgainWithAFreshSuffix()
    {
        var phone = GeneratePhone();
        string DevToken() => $"{Msg91WidgetVerifier.DevTokenPrefix}{phone}:{Guid.NewGuid():N}";

        using var first = _factory.CreateClient();
        (await SignInAsync(first, phone, token: DevToken(), fullName: "Sneha", email: NewEmail()))
            .StatusCode.ShouldBe(HttpStatusCode.OK);

        using var second = _factory.CreateClient();
        (await SignInAsync(second, phone, token: DevToken()))
            .StatusCode.ShouldBe(HttpStatusCode.OK);
    }
}
