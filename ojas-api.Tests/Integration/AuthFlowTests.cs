using System.Net;
using MongoDB.Driver;
using System.Net.Http.Json;
using OjasApi.Models;
using OjasApi.Tests.TestHelpers;
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
    public async Task Refresh_ReplayingAJustRotatedToken_RenewsAccessButIssuesNoRefreshToken()
    {
        // The honest two-tab case. Both tabs in one browser share a cookie jar, so when the
        // access token expires they can both refresh with the same value; signing the loser out
        // for that would be a bug. It gets a working access token - and deliberately no refresh
        // token, because the jar already holds the successor the winner was issued. Handing it
        // one would fork the family into two branches that rotate independently forever, which
        // is precisely the session a token thief would want.
        var originalRefreshToken = await RegisterAndGetRefreshTokenAsync();

        var refreshResponse = await _client.PostAsync("/api/auth/refresh", null);
        refreshResponse.StatusCode.ShouldBe(HttpStatusCode.OK);

        // A fresh client with an empty cookie jar - reusing _client would have its own handler
        // auto-attach the *current* (already-rotated) cookie instead of the stale one this test
        // needs to send explicitly.
        using var replayClient = _factory.CreateClient();
        using var replayRequest = new HttpRequestMessage(HttpMethod.Post, "/api/auth/refresh");
        replayRequest.Headers.Add("Cookie", $"ojas_refresh={originalRefreshToken}");
        var replayResponse = await replayClient.SendAsync(replayRequest);

        replayResponse.StatusCode.ShouldBe(HttpStatusCode.OK);
        var setCookies = replayResponse.Headers.TryGetValues("Set-Cookie", out var values)
            ? values.ToList()
            : [];
        setCookies.ShouldContain(c => c.StartsWith("ojas_auth="));
        setCookies.ShouldNotContain(c => c.StartsWith("ojas_refresh="));
    }

    [Fact]
    public async Task Refresh_ReplayingALongSpentToken_RevokesTheWholeSessionFamily()
    {
        // Nobody's browser sits on a spent refresh token for minutes and then tries it. Someone
        // else has a copy, and the thief's request can't be told apart from the owner's - so
        // every token descended from that sign-in dies and the real user signs in again.
        var originalRefreshToken = await RegisterAndGetRefreshTokenAsync();

        var refreshResponse = await _client.PostAsync("/api/auth/refresh", null);
        refreshResponse.StatusCode.ShouldBe(HttpStatusCode.OK);
        var successorToken = ExtractCookieValue(refreshResponse, "ojas_refresh");

        // Age the spent row past the grace window, which is the only thing separating an honest
        // two-tab race from a replay.
        await _factory.SeedAsync(async db =>
        {
            await db.RefreshTokens.UpdateManyAsync(
                Builders<RefreshToken>.Filter.Ne(r => r.RotatedAt, null),
                Builders<RefreshToken>.Update.Set(r => r.RotatedAt, DateTime.UtcNow.AddMinutes(-10)));
        });

        using var replayClient = _factory.CreateClient();
        using var replayRequest = new HttpRequestMessage(HttpMethod.Post, "/api/auth/refresh");
        replayRequest.Headers.Add("Cookie", $"ojas_refresh={originalRefreshToken}");
        var replayResponse = await replayClient.SendAsync(replayRequest);

        replayResponse.StatusCode.ShouldBe(HttpStatusCode.Unauthorized);

        // And the legitimate successor is gone too - that is what revoking the family means, and
        // it is the point: the real user is forced to sign in again rather than left sharing a
        // session with whoever else is holding a token.
        using var successorClient = _factory.CreateClient();
        using var successorRequest = new HttpRequestMessage(HttpMethod.Post, "/api/auth/refresh");
        successorRequest.Headers.Add("Cookie", $"ojas_refresh={successorToken}");
        var successorResponse = await successorClient.SendAsync(successorRequest);

        successorResponse.StatusCode.ShouldBe(HttpStatusCode.Unauthorized);
    }

    [Fact]
    public async Task Logout_RevokesEveryTokenFromThatSignIn_IncludingAGraceWindowSibling()
    {
        var originalRefreshToken = await RegisterAndGetRefreshTokenAsync();

        var refreshResponse = await _client.PostAsync("/api/auth/refresh", null);
        var successorToken = ExtractCookieValue(refreshResponse, "ojas_refresh");

        (await _client.PostAsync("/api/auth/logout", null)).StatusCode.ShouldBe(HttpStatusCode.NoContent);

        foreach (var token in new[] { originalRefreshToken, successorToken })
        {
            using var client = _factory.CreateClient();
            using var request = new HttpRequestMessage(HttpMethod.Post, "/api/auth/refresh");
            request.Headers.Add("Cookie", $"ojas_refresh={token}");
            (await client.SendAsync(request)).StatusCode.ShouldBe(HttpStatusCode.Unauthorized);
        }
    }

    /// <summary>Registers a throwaway verified account on _client and returns the refresh token
    /// its session was issued. Registration is two verification steps now - the session only
    /// exists once both are done.</summary>
    private async Task<string> RegisterAndGetRefreshTokenAsync()
    {
        var suffix = Guid.NewGuid().ToString("N")[..8];
        // Digits only - see AuthFlowExtensions.RegisterAsync for why a hex suffix breaks phone
        // verification now that it's actually checked.
        var phone = $"9{Math.Abs(Guid.NewGuid().GetHashCode()).ToString().PadLeft(9, '0')[..9]}";
        var registerRequest = new RegisterRequest(
            $"Test User {suffix}", $"user.{suffix}@example.com", phone, "Passw0rd123!", "test-turnstile-token");
        var registerResponse = await _client.PostAsJsonAsync("/api/auth/register", registerRequest);
        var pending = await registerResponse.Content.ReadFromJsonAsync<RegisterPendingResponse>();

        await _client.PostAsJsonAsync(
            "/api/auth/verify-email-otp", new VerifyEmailOtpRequest(pending!.Email, pending.DevCode!));

        var verifyPhoneResponse = await _client.PostAsJsonAsync(
            "/api/auth/verify-phone-registration",
            new VerifyPhoneRegistrationRequest(phone, FakeMsg91WidgetHandler.TokenFor(phone)));
        return ExtractCookieValue(verifyPhoneResponse, "ojas_refresh");
    }

    private static string ExtractCookieValue(HttpResponseMessage response, string cookieName)
    {
        var setCookieHeaders = response.Headers.TryGetValues("Set-Cookie", out var values) ? values : [];
        var match = setCookieHeaders.FirstOrDefault(c => c.StartsWith($"{cookieName}="))
            ?? throw new InvalidOperationException($"No Set-Cookie header for '{cookieName}'.");
        return match.Split(';')[0][(cookieName.Length + 1)..];
    }
}
