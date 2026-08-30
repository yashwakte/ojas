using System.Net;
using System.Net.Http.Json;
using OjasApi.Models;
using OjasApi.Tests.TestHelpers;
using Shouldly;

namespace OjasApi.Tests.Integration;

/// <summary>
/// Registration now requires two proofs - an emailed code and an MSG91-verified phone - before
/// a session exists, completable in either order. Login afterwards takes either the email or the
/// phone as the identifier and never touches MSG91 again, since both were already verified once
/// at signup. Most of this flow is already exercised indirectly by every other integration test
/// via AuthFlowExtensions.RegisterAsync (email-then-phone order); these tests cover the specific
/// new behaviours that helper doesn't - the reverse order, an abandoned registration, a failed
/// widget verification, and signing in with the phone identifier.
/// </summary>
[Collection(MongoCollectionFixture.Name)]
public class RegistrationTests : IDisposable
{
    private readonly OjasApiFactory _factory;

    public RegistrationTests(MongoRunnerFixture mongo) => _factory = new OjasApiFactory(mongo);
    public void Dispose() => _factory.Dispose();

    private static string GeneratePhone(string leadingDigit = "9") =>
        $"{leadingDigit}{Math.Abs(Guid.NewGuid().GetHashCode()).ToString().PadLeft(9, '0')[..9]}";

    private async Task<(string Email, string Phone, string DevCode)> RegisterPendingAsync(HttpClient client)
    {
        var suffix = Guid.NewGuid().ToString("N")[..8];
        var email = $"user.{suffix}@example.com";
        var phone = GeneratePhone();
        var request = new RegisterRequest($"Test User {suffix}", email, phone, "Passw0rd123!", "test-turnstile-token");

        var response = await client.PostAsJsonAsync("/api/auth/register", request);
        response.EnsureSuccessStatusCode();
        var pending = await response.Content.ReadFromJsonAsync<RegisterPendingResponse>();
        return (email, phone, pending!.DevCode!);
    }

    [Fact]
    public async Task VerifyingPhoneFirst_ThenEmail_AlsoCompletesRegistration()
    {
        using var client = _factory.CreateClient();
        var (email, phone, devCode) = await RegisterPendingAsync(client);

        var phoneResponse = await client.PostAsJsonAsync(
            "/api/auth/verify-phone-registration",
            new VerifyPhoneRegistrationRequest(phone, FakeMsg91WidgetHandler.TokenFor(phone)));
        var phoneStep = await phoneResponse.Content.ReadFromJsonAsync<RegistrationStepResponse>();
        phoneStep!.PhoneVerified.ShouldBeTrue();
        phoneStep.EmailVerified.ShouldBeFalse();
        phoneStep.Session.ShouldBeNull();

        var emailResponse = await client.PostAsJsonAsync(
            "/api/auth/verify-email-otp", new VerifyEmailOtpRequest(email, devCode));
        var emailStep = await emailResponse.Content.ReadFromJsonAsync<RegistrationStepResponse>();
        emailStep!.EmailVerified.ShouldBeTrue();
        emailStep.PhoneVerified.ShouldBeTrue();
        emailStep.Session.ShouldNotBeNull();
        emailStep.Session!.Email.ShouldBe(email);
    }

    /// <summary>Without this, an account could verify email, then log in with password forever
    /// and never actually finish phone verification - silently defeating "verify both at
    /// registration."</summary>
    [Fact]
    public async Task AnAccountThatOnlyVerifiedEmail_CannotLogIn_AndIsToldToFinishPhoneVerification()
    {
        using var client = _factory.CreateClient();
        var (email, phone, devCode) = await RegisterPendingAsync(client);

        await client.PostAsJsonAsync("/api/auth/verify-email-otp", new VerifyEmailOtpRequest(email, devCode));

        var login = await client.PostAsJsonAsync(
            "/api/auth/login", new LoginRequest(email, "Passw0rd123!", "test-turnstile-token"));

        login.StatusCode.ShouldBe(HttpStatusCode.Forbidden);
        var body = await login.Content.ReadFromJsonAsync<NeedsPhoneVerificationResponse>();
        body!.NeedsPhoneVerification.ShouldBeTrue();
        body.Phone.ShouldBe(phone);
    }

    private record NeedsPhoneVerificationResponse(bool NeedsPhoneVerification, string Email, string Phone);

    [Fact]
    public async Task AnAccountThatOnlyVerifiedPhone_CannotLogIn_AndIsToldToFinishEmailVerification()
    {
        using var client = _factory.CreateClient();
        var (email, phone, _) = await RegisterPendingAsync(client);

        await client.PostAsJsonAsync(
            "/api/auth/verify-phone-registration",
            new VerifyPhoneRegistrationRequest(phone, FakeMsg91WidgetHandler.TokenFor(phone)));

        var login = await client.PostAsJsonAsync(
            "/api/auth/login", new LoginRequest(email, "Passw0rd123!", "test-turnstile-token"));

        login.StatusCode.ShouldBe(HttpStatusCode.Forbidden);
        var body = await login.Content.ReadFromJsonAsync<NeedsEmailVerificationResponse>();
        body!.NeedsEmailVerification.ShouldBeTrue();
    }

    private record NeedsEmailVerificationResponse(bool NeedsEmailVerification, string Email);

    [Fact]
    public async Task AFailedWidgetVerification_LeavesRegistrationIncomplete()
    {
        using var client = _factory.CreateClient();
        var (_, phone, _) = await RegisterPendingAsync(client);

        var response = await client.PostAsJsonAsync(
            "/api/auth/verify-phone-registration",
            new VerifyPhoneRegistrationRequest(phone, "a-token-msg91-never-issued"));

        response.StatusCode.ShouldBe(HttpStatusCode.BadRequest);
    }

    [Fact]
    public async Task OnceRegistered_TheCustomerCanSignInWithTheirPhoneNumberInstead()
    {
        using var client = _factory.CreateClient();
        var (email, phone, devCode) = await RegisterPendingAsync(client);
        await client.PostAsJsonAsync("/api/auth/verify-email-otp", new VerifyEmailOtpRequest(email, devCode));
        await client.PostAsJsonAsync(
            "/api/auth/verify-phone-registration",
            new VerifyPhoneRegistrationRequest(phone, FakeMsg91WidgetHandler.TokenFor(phone)));

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
        var (email, phone, devCode) = await RegisterPendingAsync(client);
        await client.PostAsJsonAsync("/api/auth/verify-email-otp", new VerifyEmailOtpRequest(email, devCode));
        await client.PostAsJsonAsync(
            "/api/auth/verify-phone-registration",
            new VerifyPhoneRegistrationRequest(phone, FakeMsg91WidgetHandler.TokenFor(phone)));

        var login = await client.PostAsJsonAsync(
            "/api/auth/login", new LoginRequest(phone, "WrongPassword1!", "test-turnstile-token"));

        login.StatusCode.ShouldBe(HttpStatusCode.Unauthorized);
    }
}
