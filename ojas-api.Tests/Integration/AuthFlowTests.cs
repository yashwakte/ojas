using System.Net;
using System.Net.Http.Json;
using OjasApi.Models;
using Shouldly;

namespace OjasApi.Tests.Integration;

[Collection(MongoCollectionFixture.Name)]
public class AuthFlowTests : IDisposable
{
    private readonly OjasApiFactory _factory;
    private readonly HttpClient _client;

    public AuthFlowTests(MongoRunnerFixture mongo)
    {
        _factory = new OjasApiFactory(mongo);
        _client = _factory.CreateClient();
    }

    public void Dispose()
    {
        _client.Dispose();
        _factory.Dispose();
    }

    [Fact]
    public async Task Register_ThenGetProfile_ReturnsTheNewUser()
    {
        var (auth, csrfToken) = await _client.RegisterAsync(fullName: "Priya Sharma");

        auth.FullName.ShouldBe("Priya Sharma");
        auth.Role.ShouldBe("customer");
        csrfToken.ShouldNotBeNullOrWhiteSpace();

        var profileResponse = await _client.GetAsync("/api/user/profile");
        profileResponse.StatusCode.ShouldBe(HttpStatusCode.OK);

        var profile = await profileResponse.Content.ReadFromJsonAsync<UserProfileResponse>();
        profile!.Email.ShouldBe(auth.Email);
    }

    [Fact]
    public async Task Register_WithDuplicateEmail_ReturnsConflict()
    {
        var (first, _) = await _client.RegisterAsync(email: "duplicate@example.com");

        using var client2 = _factory.CreateClient();
        var request = new RegisterRequest("Someone Else", first.Email, "9123456780", "Passw0rd123!", "test-turnstile-token");
        var response = await client2.PostAsJsonAsync("/api/auth/register", request);

        response.StatusCode.ShouldBe(HttpStatusCode.Conflict);
    }

    [Fact]
    public async Task Login_WithWrongPassword_ReturnsUnauthorized()
    {
        var (auth, _) = await _client.RegisterAsync();

        using var client2 = _factory.CreateClient();
        var response = await client2.PostAsJsonAsync("/api/auth/login", new LoginRequest(auth.Email, "WrongPassword1!", "test-turnstile-token"));

        response.StatusCode.ShouldBe(HttpStatusCode.Unauthorized);
    }

    [Fact]
    public async Task MutatingRequest_WithoutCsrfHeader_IsForbidden()
    {
        await _client.RegisterAsync();

        var response = await _client.PutAsJsonAsync("/api/user/profile", new UpdateProfileRequest("New Name", "new@example.com", "9999999999"));

        response.StatusCode.ShouldBe(HttpStatusCode.Forbidden);
    }

    [Fact]
    public async Task AdminOnlyEndpoint_RejectsCustomer_ButAllowsSeededAdmin()
    {
        await _client.RegisterAsync();

        var customerAttempt = await _client.GetAsync("/api/orders/admin/all");
        customerAttempt.StatusCode.ShouldBe(HttpStatusCode.Forbidden);

        using var adminClient = _factory.CreateClient();
        await _factory.SeedAndLoginAsStaffAsync(adminClient, UserRoles.Admin);

        var adminAttempt = await adminClient.GetAsync("/api/orders/admin/all");
        adminAttempt.StatusCode.ShouldBe(HttpStatusCode.OK);
    }

    [Fact]
    public async Task Refresh_WithValidCookie_IssuesFreshAccessTokenAndCsrfToken()
    {
        var (auth, csrfToken) = await _client.RegisterAsync();

        var refreshResponse = await _client.PostAsync("/api/auth/refresh", null);
        refreshResponse.StatusCode.ShouldBe(HttpStatusCode.OK);
        var refreshed = await refreshResponse.Content.ReadFromJsonAsync<AuthResponse>();

        refreshed!.Email.ShouldBe(auth.Email);
        refreshed.CsrfToken.ShouldNotBeNullOrWhiteSpace();
        refreshed.CsrfToken.ShouldNotBe(csrfToken);

        // The new access token cookie the client just picked up is actually usable.
        var profileResponse = await _client.GetAsync("/api/user/profile");
        profileResponse.StatusCode.ShouldBe(HttpStatusCode.OK);
    }

    [Fact]
    public async Task Refresh_WithNoCookie_ReturnsUnauthorized()
    {
        using var client = _factory.CreateClient();

        var response = await client.PostAsync("/api/auth/refresh", null);

        response.StatusCode.ShouldBe(HttpStatusCode.Unauthorized);
    }

    [Fact]
    public async Task Refresh_AfterLogout_ReturnsUnauthorized()
    {
        await _client.RegisterAsync();

        var logoutResponse = await _client.PostAsync("/api/auth/logout", null);
        logoutResponse.StatusCode.ShouldBe(HttpStatusCode.NoContent);

        var refreshResponse = await _client.PostAsync("/api/auth/refresh", null);
        refreshResponse.StatusCode.ShouldBe(HttpStatusCode.Unauthorized);
    }

    [Fact]
    public async Task Refresh_RotatesToken_ReplayingTheOldCookieFails()
    {
        var suffix = Guid.NewGuid().ToString("N")[..8];
        var registerRequest = new RegisterRequest(
            $"Test User {suffix}", $"user.{suffix}@example.com", $"9{suffix.PadRight(9, '0')}", "Passw0rd123!", "test-turnstile-token");
        var registerResponse = await _client.PostAsJsonAsync("/api/auth/register", registerRequest);
        var pending = await registerResponse.Content.ReadFromJsonAsync<RegisterPendingResponse>();

        var verifyResponse = await _client.PostAsJsonAsync(
            "/api/auth/verify-email-otp", new VerifyEmailOtpRequest(pending!.Email, pending.DevCode!));
        var originalRefreshToken = ExtractCookieValue(verifyResponse, "ojas_refresh");

        // First refresh succeeds and rotates - the client's own cookie jar now holds a new token.
        var refreshResponse = await _client.PostAsync("/api/auth/refresh", null);
        refreshResponse.StatusCode.ShouldBe(HttpStatusCode.OK);

        // Explicitly replaying the original (now-rotated-away) token must fail, proving rotation
        // actually invalidates it rather than just issuing a redundant new one alongside it. Uses
        // a fresh client with an empty cookie jar - reusing _client here would have its own
        // handler auto-attach the *current* (already-rotated) cookie instead of the stale one
        // this test needs to send explicitly.
        using var replayClient = _factory.CreateClient();
        using var replayRequest = new HttpRequestMessage(HttpMethod.Post, "/api/auth/refresh");
        replayRequest.Headers.Add("Cookie", $"ojas_refresh={originalRefreshToken}");
        var replayResponse = await replayClient.SendAsync(replayRequest);

        replayResponse.StatusCode.ShouldBe(HttpStatusCode.Unauthorized);
    }

    private static string ExtractCookieValue(HttpResponseMessage response, string cookieName)
    {
        var setCookieHeaders = response.Headers.TryGetValues("Set-Cookie", out var values) ? values : [];
        var match = setCookieHeaders.FirstOrDefault(c => c.StartsWith($"{cookieName}="))
            ?? throw new InvalidOperationException($"No Set-Cookie header for '{cookieName}'.");
        return match.Split(';')[0][(cookieName.Length + 1)..];
    }
}
