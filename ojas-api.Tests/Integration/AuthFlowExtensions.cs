using System.Net.Http.Json;
using OjasApi.Models;
using OjasApi.Services;
using OjasApi.Tests.TestHelpers;

namespace OjasApi.Tests.Integration;

/// <summary>
/// WebApplicationFactory's HttpClient auto-persists cookies across requests on the same instance
/// (WebApplicationFactoryClientOptions.HandleCookies defaults to true), so once you register/login
/// on a client, its ojas_auth cookie flows automatically on later requests to that same client.
/// The double-submit CSRF token is NOT a cookie the server reads - the app compares the ojas_csrf
/// cookie against an X-CSRF-Token header, so callers must attach the returned token manually to
/// every POST/PUT/PATCH/DELETE.
/// </summary>
public static class AuthFlowExtensions
{
    /// <summary>Registration is now three steps - create the account, verify the emailed code,
    /// and verify the phone via the MSG91 OTP Widget - completable in either order, with no
    /// session until both are done. The test host runs in Development, so the register response
    /// includes the email code directly (DevCode) instead of requiring a real inbox; the phone
    /// step uses FakeMsg91WidgetHandler.TokenFor, a token this suite's fake widget transport
    /// accepts without needing a reference to the OjasApiFactory that owns it - this helper is an
    /// HttpClient extension with no way to reach the factory.</summary>
    public static async Task<(AuthResponse Auth, string CsrfToken)> RegisterAsync(
        this HttpClient client, string? fullName = null, string? email = null, string? phone = null, string password = "Passw0rd123!")
    {
        var suffix = Guid.NewGuid().ToString("N")[..8];
        // Guid.ToString("N") is hex, not decimal - it can contain letters (a-f), which
        // Msg91WidgetVerifier's phone comparison strips out along with any other non-digit
        // character. A real phone number never contains letters, and now that phone verification
        // is actually checked (not just stored), a hex-letter "phone" fails that check instead of
        // being silently ignored the way it used to be - so this has to be digits only.
        var resolvedPhone = phone ?? $"9{Math.Abs(Guid.NewGuid().GetHashCode()).ToString().PadLeft(9, '0')[..9]}";
        var request = new RegisterRequest(
            fullName ?? $"Test User {suffix}",
            email ?? $"user.{suffix}@example.com",
            resolvedPhone,
            password,
            "test-turnstile-token");

        var response = await client.PostAsJsonAsync("/api/auth/register", request);
        response.EnsureSuccessStatusCode();
        var pending = await response.Content.ReadFromJsonAsync<RegisterPendingResponse>();

        var verifyEmailResponse = await client.PostAsJsonAsync(
            "/api/auth/verify-email-otp",
            new VerifyEmailOtpRequest(pending!.Email, pending.DevCode!));
        verifyEmailResponse.EnsureSuccessStatusCode();

        var verifyPhoneResponse = await client.PostAsJsonAsync(
            "/api/auth/verify-phone-registration",
            new VerifyPhoneRegistrationRequest(resolvedPhone, FakeMsg91WidgetHandler.TokenFor(resolvedPhone)));
        verifyPhoneResponse.EnsureSuccessStatusCode();
        var step = await verifyPhoneResponse.Content.ReadFromJsonAsync<RegistrationStepResponse>();
        var auth = step!.Session;
        return (auth!, auth!.CsrfToken!);
    }

    public static async Task<(AuthResponse Auth, string CsrfToken)> LoginAsync(
        this HttpClient client, string email, string password)
    {
        var response = await client.PostAsJsonAsync("/api/auth/login", new LoginRequest(email, password, "test-turnstile-token"));
        response.EnsureSuccessStatusCode();
        var auth = await response.Content.ReadFromJsonAsync<AuthResponse>();
        return (auth!, auth!.CsrfToken!);
    }

    public static void AttachCsrf(this HttpRequestMessage request, string csrfToken)
    {
        request.Headers.Add("X-CSRF-Token", csrfToken);
    }

    /// <summary>Enrols the calling client as a staff account's single trusted device, which is
    /// what an ordinary login now requires. Mirrors the real two-step flow (request a code, then
    /// redeem it); the test host runs in Development so the code comes back in the response.</summary>
    public static async Task<(AuthResponse Auth, string CsrfToken)> EnrollDeviceAndLoginAsync(
        this HttpClient client, string email, string password)
    {
        var otpResponse = await client.PostAsJsonAsync(
            "/api/auth/device/send-otp", new DeviceOtpRequest(email, password));
        otpResponse.EnsureSuccessStatusCode();
        var otp = await otpResponse.Content.ReadFromJsonAsync<DeviceOtpDevResponse>();

        var response = await client.PostAsJsonAsync(
            "/api/auth/device/enroll", new EnrollDeviceRequest(email, password, otp!.DevCode!));
        response.EnsureSuccessStatusCode();
        var auth = await response.Content.ReadFromJsonAsync<AuthResponse>();
        return (auth!, auth!.CsrfToken!);
    }

    /// <summary>Inserts a pre-hashed admin/delivery user straight into the test database and signs
    /// in as them, sidestepping the admin-only /api/auth/staff endpoint's bootstrap problem. Staff
    /// are device-restricted, so this enrols the calling client as their trusted device rather
    /// than logging in directly - a plain login would (correctly) be refused with a 403.</summary>
    public static async Task<(AuthResponse Auth, string CsrfToken)> SeedAndLoginAsStaffAsync(
        this OjasApiFactory factory, HttpClient client, string role, string? email = null, string password = "Passw0rd123!")
    {
        var suffix = Guid.NewGuid().ToString("N")[..8];
        email ??= $"{role}.{suffix}@example.com";

        await factory.SeedAsync(async db =>
        {
            var user = new User
            {
                FullName = $"Test {role} {suffix}",
                Email = email,
                Phone = $"8{suffix.PadRight(9, '0')}",
                PasswordHash = BCrypt.Net.BCrypt.HashPassword(password),
                Role = role,
                IsEmailVerified = true,
                IsPhoneVerified = true,
            };
            await db.Users.InsertOneAsync(user);
        });

        return await client.EnrollDeviceAndLoginAsync(email, password);
    }

    /// <summary>The device/send-otp response is an anonymous object on the server side; this is
    /// just the shape the tests need to read the Development-only code back out of it.</summary>
    private record DeviceOtpDevResponse(string Message, string? DevCode);
}
