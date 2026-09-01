using System.Net;
using System.Net.Http.Json;
using OjasApi.Models;
using OjasApi.Tests.TestHelpers;
using Shouldly;

namespace OjasApi.Tests.Integration;

/// <summary>
/// Registration is verified by phone alone. Signing up sends no email code at all - the account is
/// created with an unverified address the customer may confirm later, on demand - and it is the
/// MSG91-verified phone that issues the session. Login afterwards takes either the email or the
/// phone as the identifier and never touches MSG91 again.
///
/// The happy path is already exercised indirectly by every other integration test via
/// AuthFlowExtensions.RegisterAsync; these tests cover what that helper doesn't - that email is
/// genuinely optional in both directions, that an unfinished phone step still blocks a login, a
/// failed widget verification, and signing in with the phone identifier.
/// </summary>
[Collection(MongoCollectionFixture.Name)]
public class RegistrationTests : IDisposable
{
    private readonly OjasApiFactory _factory;

    public RegistrationTests(MongoRunnerFixture mongo) => _factory = new OjasApiFactory(mongo);
    public void Dispose() => _factory.Dispose();

    private static string GeneratePhone(string leadingDigit = "9") =>
        $"{leadingDigit}{Math.Abs(Guid.NewGuid().GetHashCode()).ToString().PadLeft(9, '0')[..9]}";

    private async Task<(string Email, string Phone)> RegisterPendingAsync(HttpClient client)
    {
        var suffix = Guid.NewGuid().ToString("N")[..8];
        var email = $"user.{suffix}@example.com";
        var phone = GeneratePhone();
        var request = new RegisterRequest($"Test User {suffix}", email, phone, "Passw0rd123!", "test-turnstile-token");

        var response = await client.PostAsJsonAsync("/api/auth/register", request);
        response.EnsureSuccessStatusCode();
        return (email, phone);
    }

    /// <summary>Registration no longer hands back a code, so a test that wants to verify an email
    /// asks for one the same way the customer's own "Verify" button does. The host runs in
    /// Development, so the code comes back in the response instead of needing a real inbox.</summary>
    private static async Task<string> RequestEmailCodeAsync(HttpClient client, string email)
    {
        var response = await client.PostAsJsonAsync("/api/auth/resend-email-otp", new ResendEmailOtpRequest(email));
        response.EnsureSuccessStatusCode();
        var body = await response.Content.ReadFromJsonAsync<ResendResponse>();
        return body!.DevCode!;
    }

    private static async Task<HttpResponseMessage> VerifyPhoneAsync(HttpClient client, string phone) =>
        await client.PostAsJsonAsync(
            "/api/auth/verify-phone-registration",
            new VerifyPhoneRegistrationRequest(phone, FakeMsg91WidgetHandler.TokenFor(phone)));

    private record ResendResponse(string Message, string? DevCode);
    private record NeedsPhoneVerificationResponse(bool NeedsPhoneVerification, string Email, string Phone);

    /// <summary>The whole of registration: no email code is sent, and verifying the phone is what
    /// signs the customer in.</summary>
    [Fact]
    public async Task RegisteringSendsNoEmailCode_AndVerifyingThePhoneIssuesTheSession()
    {
        using var client = _factory.CreateClient();
        var suffix = Guid.NewGuid().ToString("N")[..8];
        var email = $"user.{suffix}@example.com";
        var phone = GeneratePhone();

        var registerResponse = await client.PostAsJsonAsync(
            "/api/auth/register",
            new RegisterRequest($"Test User {suffix}", email, phone, "Passw0rd123!", "test-turnstile-token"));
        registerResponse.EnsureSuccessStatusCode();
        var pending = await registerResponse.Content.ReadFromJsonAsync<RegisterPendingResponse>();
        // Development would return a real code here if one had been sent; null is the proof that
        // registration didn't send one.
        pending!.DevCode.ShouldBeNull();

        var phoneResponse = await VerifyPhoneAsync(client, phone);
        var step = await phoneResponse.Content.ReadFromJsonAsync<RegistrationStepResponse>();

        step!.PhoneVerified.ShouldBeTrue();
        step.EmailVerified.ShouldBeFalse();
        step.Session.ShouldNotBeNull();
        step.Session!.Email.ShouldBe(email);
    }

    /// <summary>Email is optional, not an alternative - confirming the address without ever
    /// proving the phone must not let anyone in.</summary>
    [Fact]
    public async Task VerifyingOnlyTheEmail_DoesNotIssueASession()
    {
        using var client = _factory.CreateClient();
        var (email, _) = await RegisterPendingAsync(client);
        var code = await RequestEmailCodeAsync(client, email);

        var response = await client.PostAsJsonAsync("/api/auth/verify-email-otp", new VerifyEmailOtpRequest(email, code));
        var step = await response.Content.ReadFromJsonAsync<RegistrationStepResponse>();

        step!.EmailVerified.ShouldBeTrue();
        step.PhoneVerified.ShouldBeFalse();
        step.Session.ShouldBeNull();
    }

    /// <summary>Without this, an account could abandon the phone step, then log in with password
    /// forever and never actually verify a number we can reach them on.</summary>
    [Fact]
    public async Task AnAccountThatNeverVerifiedItsPhone_CannotLogIn_AndIsToldWhy()
    {
        using var client = _factory.CreateClient();
        var (email, phone) = await RegisterPendingAsync(client);

        var login = await client.PostAsJsonAsync(
            "/api/auth/login", new LoginRequest(email, "Passw0rd123!", "test-turnstile-token"));

        login.StatusCode.ShouldBe(HttpStatusCode.Forbidden);
        var body = await login.Content.ReadFromJsonAsync<NeedsPhoneVerificationResponse>();
        body!.NeedsPhoneVerification.ShouldBeTrue();
        body.Phone.ShouldBe(phone);
    }

    /// <summary>The counterpart of the test above, and the point of the whole change: an
    /// unverified email address must never stand between a customer and their account.</summary>
    [Fact]
    public async Task AnAccountWithAnUnverifiedEmail_CanStillSignIn()
    {
        using var client = _factory.CreateClient();
        var (email, phone) = await RegisterPendingAsync(client);
        await VerifyPhoneAsync(client, phone);

        var login = await client.PostAsJsonAsync(
            "/api/auth/login", new LoginRequest(email, "Passw0rd123!", "test-turnstile-token"));

        login.StatusCode.ShouldBe(HttpStatusCode.OK);
    }

    /// <summary>The "Verify" button on the account screen: an address confirmed after the fact
    /// still gets recorded, so the flag means the same thing however it was earned.</summary>
    [Fact]
    public async Task AnEmailCanBeVerifiedAfterSigningIn()
    {
        using var client = _factory.CreateClient();
        var (email, phone) = await RegisterPendingAsync(client);
        await VerifyPhoneAsync(client, phone);

        var code = await RequestEmailCodeAsync(client, email);
        var response = await client.PostAsJsonAsync("/api/auth/verify-email-otp", new VerifyEmailOtpRequest(email, code));
        var step = await response.Content.ReadFromJsonAsync<RegistrationStepResponse>();

        step!.EmailVerified.ShouldBeTrue();
        step.PhoneVerified.ShouldBeTrue();
    }

    [Fact]
    public async Task AFailedWidgetVerification_LeavesRegistrationIncomplete()
    {
        using var client = _factory.CreateClient();
        var (_, phone) = await RegisterPendingAsync(client);

        var response = await client.PostAsJsonAsync(
            "/api/auth/verify-phone-registration",
            new VerifyPhoneRegistrationRequest(phone, "a-token-msg91-never-issued"));

        response.StatusCode.ShouldBe(HttpStatusCode.BadRequest);
    }

    [Fact]
    public async Task OnceRegistered_TheCustomerCanSignInWithTheirPhoneNumberInstead()
    {
        using var client = _factory.CreateClient();
        var (email, phone) = await RegisterPendingAsync(client);
        await VerifyPhoneAsync(client, phone);

        var login = await client.PostAsJsonAsync(
            "/api/auth/login", new LoginRequest(phone, "Passw0rd123!", "test-turnstile-token"));

        login.StatusCode.ShouldBe(HttpStatusCode.OK);
        var auth = await login.Content.ReadFromJsonAsync<AuthResponse>();
        auth!.Email.ShouldBe(email);
    }

    [Fact]
    public async Task LoginWithThePhoneIdentifier_StillRequiresTheCorrectPassword()
    {
        using var client = _factory.CreateClient();
        var (_, phone) = await RegisterPendingAsync(client);
        await VerifyPhoneAsync(client, phone);

        var login = await client.PostAsJsonAsync(
            "/api/auth/login", new LoginRequest(phone, "WrongPassword1!", "test-turnstile-token"));

        login.StatusCode.ShouldBe(HttpStatusCode.Unauthorized);
    }
}
