using System.Net;
using System.Net.Http.Json;
using Microsoft.AspNetCore.Mvc.Testing;
using OjasApi.Models;
using OjasApi.Tests.TestHelpers;
using Shouldly;

namespace OjasApi.Tests.Integration;

/// <summary>
/// A silent refresh must never be refused because of somebody else's traffic.
///
/// It used to share the general limiter, which counts a caller with no live access token by
/// address - and an expired access token is exactly when a refresh happens. Behind the production
/// proxy that address is shared by every anonymous visitor, so the refresh came back 429 and the
/// frontend signed a valid session out. This test host gives every caller the same address too,
/// which makes it a faithful stand-in for that proxy.
/// </summary>
[Collection(MongoCollectionFixture.Name)]
public class RefreshRateLimitTests : IDisposable
{
    private readonly OjasApiFactory _factory;
    private readonly HttpClient _client;

    public RefreshRateLimitTests(MongoRunnerFixture mongo)
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
    public async Task Other_visitors_using_up_the_shared_anonymous_budget_cannot_block_a_refresh()
    {
        var refreshToken = await RegisterAndGetRefreshTokenAsync();

        // Strangers browsing the shop anonymously until the general limiter turns them away.
        using var strangers = _factory.CreateClient();
        var last = HttpStatusCode.OK;
        for (var i = 0; i < 100 && last != HttpStatusCode.TooManyRequests; i++)
            last = (await strangers.GetAsync("/api/products")).StatusCode;
        last.ShouldBe(HttpStatusCode.TooManyRequests);

        // The returning customer: their access token is long gone, so this call is anonymous too.
        (await RefreshWithAsync(refreshToken)).StatusCode.ShouldBe(HttpStatusCode.OK);
    }

    [Fact]
    public async Task One_refresh_token_hammered_on_its_own_is_still_limited()
    {
        var refreshToken = await RegisterAndGetRefreshTokenAsync();

        var statuses = new List<HttpStatusCode>();
        for (var i = 0; i < 31; i++)
            statuses.Add((await RefreshWithAsync(refreshToken)).StatusCode);

        // The first call rotates the token; the rest land inside the rotation grace window, which
        // is what two tabs refreshing at once look like, and are answered too.
        statuses.Take(30).ShouldAllBe(status => status == HttpStatusCode.OK);
        statuses[30].ShouldBe(HttpStatusCode.TooManyRequests);
    }

    /// <summary>A client with no cookie jar of its own, carrying only the refresh cookie - the
    /// state a browser is in when it comes back after the 15-minute access token has expired.</summary>
    private async Task<HttpResponseMessage> RefreshWithAsync(string refreshToken)
    {
        using var client = _factory.CreateClient(new WebApplicationFactoryClientOptions { HandleCookies = false });
        using var request = new HttpRequestMessage(HttpMethod.Post, "/api/auth/refresh");
        request.Headers.Add("Cookie", $"ojas_refresh={refreshToken}");
        return await client.SendAsync(request);
    }

    private async Task<string> RegisterAndGetRefreshTokenAsync()
    {
        var suffix = Guid.NewGuid().ToString("N")[..8];
        // Digits only - see AuthFlowExtensions.RegisterAsync.
        var phone = $"9{Math.Abs(Guid.NewGuid().GetHashCode()).ToString().PadLeft(9, '0')[..9]}";
        var registerResponse = await _client.PostAsJsonAsync("/api/auth/register", new RegisterRequest(
            $"Test User {suffix}", $"user.{suffix}@example.com", phone, "Passw0rd123!", "test-turnstile-token"));
        registerResponse.EnsureSuccessStatusCode();

        var verifyPhoneResponse = await _client.PostAsJsonAsync(
            "/api/auth/verify-phone-registration",
            new VerifyPhoneRegistrationRequest(phone, FakeMsg91WidgetHandler.TokenFor(phone)));
        verifyPhoneResponse.EnsureSuccessStatusCode();

        var setCookies = verifyPhoneResponse.Headers.TryGetValues("Set-Cookie", out var values) ? values : [];
        var refreshCookie = setCookies.First(c => c.StartsWith("ojas_refresh="));
        return refreshCookie.Split(';')[0]["ojas_refresh=".Length..];
    }
}
