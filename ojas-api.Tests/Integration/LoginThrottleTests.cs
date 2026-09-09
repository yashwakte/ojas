using System.Net;
using System.Net.Http.Json;
using MongoDB.Driver;
using OjasApi.Models;
using OjasApi.Tests.TestHelpers;
using Shouldly;

namespace OjasApi.Tests.Integration;

/// <summary>
/// Guessing a password has to get harder the more it is tried, and it has to get harder in a way
/// that does not depend on where the guesses come from.
///
/// The IP rate limiter cannot carry this on its own. Behind a CDN or a managed proxy every
/// customer can share a handful of egress addresses, so an address-scoped limit is simultaneously
/// too coarse to stop one attacker and tight enough to lock out real customers; and an attacker
/// with a botnet simply brings more addresses. A cooldown attached to the account is indifferent
/// to both.
/// </summary>
[Collection(MongoCollectionFixture.Name)]
public class LoginThrottleTests : IDisposable
{
    private readonly OjasApiFactory _factory;
    private readonly HttpClient _client;

    public LoginThrottleTests(MongoRunnerFixture mongo)
    {
        _factory = new OjasApiFactory(mongo);
        _client = _factory.CreateClient();
    }

    public void Dispose()
    {
        _client.Dispose();
        _factory.Dispose();
    }

    private const string RealPassword = "Passw0rd123!";
    private const string WrongPassword = "not-the-password";

    private Task<HttpResponseMessage> AttemptAsync(string identifier, string password) =>
        _client.PostAsJsonAsync(
            "/api/auth/login", new LoginRequest(identifier, password, "test-turnstile-token"));

    private async Task<string> RegisterAndSignOutAsync()
    {
        var (auth, csrf) = await _client.RegisterAsync(password: RealPassword);

        // Registration leaves a session on this client; the tests below are about signing in from
        // nothing, so it has to go.
        var logout = new HttpRequestMessage(HttpMethod.Post, "/api/auth/logout");
        logout.AttachCsrf(csrf);
        await _client.SendAsync(logout);

        return auth.Email;
    }

    private async Task<User> ReadUserAsync(string email)
    {
        User user = null!;
        await _factory.SeedAsync(async db =>
            user = await db.Users.Find(u => u.Email == email).FirstAsync());
        return user;
    }

    private async Task SetFailedLoginsAsync(string email, int count, DateTime? blockedUntil)
    {
        await _factory.SeedAsync(async db => await db.Users.UpdateOneAsync(
            u => u.Email == email,
            Builders<User>.Update
                .Set(u => u.FailedLoginCount, count)
                .Set(u => u.LoginBlockedUntil, blockedUntil)));
    }

    [Fact]
    public async Task RepeatedWrongPasswords_EventuallyStopTheAccountAnsweringAtAll()
    {
        var email = await RegisterAndSignOutAsync();

        for (var attempt = 0; attempt < 5; attempt++)
            (await AttemptAsync(email, WrongPassword)).StatusCode.ShouldBe(HttpStatusCode.Unauthorized);

        // The password is now correct and is still refused: the account is in its cooldown.
        (await AttemptAsync(email, RealPassword)).StatusCode.ShouldBe(HttpStatusCode.Unauthorized);

        var user = await ReadUserAsync(email);
        user.LoginBlockedUntil.ShouldNotBeNull();
        user.LoginBlockedUntil!.Value.ShouldBeGreaterThan(DateTime.UtcNow);
    }

    /// <summary>
    /// The cooldown must not become an oracle. A refusal because the account is in cooldown has to
    /// look exactly like a refusal because the password was wrong - otherwise "this account is
    /// temporarily locked" confirms the address is registered, and tells whoever is guessing
    /// precisely when to come back.
    /// </summary>
    [Fact]
    public async Task ARefusalDuringCooldown_IsWordedExactlyLikeAWrongPassword()
    {
        var email = await RegisterAndSignOutAsync();

        var ordinaryRefusal = await AttemptAsync(email, WrongPassword);
        var ordinaryBody = await ordinaryRefusal.Content.ReadAsStringAsync();

        await SetFailedLoginsAsync(email, 9, DateTime.UtcNow.AddMinutes(10));

        var throttledRefusal = await AttemptAsync(email, RealPassword);

        throttledRefusal.StatusCode.ShouldBe(ordinaryRefusal.StatusCode);
        (await throttledRefusal.Content.ReadAsStringAsync()).ShouldBe(ordinaryBody);
    }

    /// <summary>A customer who mistypes their password a few times and then gets it right must not
    /// be carrying those failures around afterwards.</summary>
    [Fact]
    public async Task ASuccessfulSignIn_ClearsWhatTheFailedAttemptsHadBuiltUp()
    {
        var email = await RegisterAndSignOutAsync();

        for (var attempt = 0; attempt < 4; attempt++)
            await AttemptAsync(email, WrongPassword);

        (await ReadUserAsync(email)).FailedLoginCount.ShouldBe(4);

        (await AttemptAsync(email, RealPassword)).StatusCode.ShouldBe(HttpStatusCode.OK);

        var user = await ReadUserAsync(email);
        user.FailedLoginCount.ShouldBe(0);
        user.LoginBlockedUntil.ShouldBeNull();
    }

    /// <summary>The escape hatch that stops this being a way to lock somebody out of their own
    /// account: proving you hold the mailbox clears the cooldown, and the failures it counted were
    /// against a password that no longer exists.</summary>
    [Fact]
    public async Task ResettingThePassword_LiftsTheCooldown()
    {
        var email = await RegisterAndSignOutAsync();
        await SetFailedLoginsAsync(email, 12, DateTime.UtcNow.AddMinutes(15));

        var forgot = await _client.PostAsJsonAsync(
            "/api/auth/forgot-password", new ForgotPasswordRequest(email, "test-turnstile-token"));
        forgot.StatusCode.ShouldBe(HttpStatusCode.OK);

        var code = (await forgot.Content.ReadFromJsonAsync<ForgotPasswordDevResponse>())!.DevCode;
        code.ShouldNotBeNullOrWhiteSpace();

        const string NewPassword = "BrandNewPassw0rd!";
        var reset = await _client.PostAsJsonAsync(
            "/api/auth/reset-password", new ResetPasswordRequest(email, code!, NewPassword));
        reset.StatusCode.ShouldBe(HttpStatusCode.OK);

        var user = await ReadUserAsync(email);
        user.FailedLoginCount.ShouldBe(0);
        user.LoginBlockedUntil.ShouldBeNull();

        (await AttemptAsync(email, NewPassword)).StatusCode.ShouldBe(HttpStatusCode.OK);
    }

    /// <summary>Only the account being guessed at is affected — a cooldown on one must never keep
    /// anybody else out.</summary>
    [Fact]
    public async Task ACooldownOnOneAccount_DoesNotAffectAnother()
    {
        var guessedAt = await RegisterAndSignOutAsync();
        await SetFailedLoginsAsync(guessedAt, 9, DateTime.UtcNow.AddMinutes(10));

        using var bystander = _factory.CreateClient();
        var (auth, csrf) = await bystander.RegisterAsync(password: RealPassword);
        var logout = new HttpRequestMessage(HttpMethod.Post, "/api/auth/logout");
        logout.AttachCsrf(csrf);
        await bystander.SendAsync(logout);

        var response = await bystander.PostAsJsonAsync(
            "/api/auth/login", new LoginRequest(auth.Email, RealPassword, "test-turnstile-token"));

        response.StatusCode.ShouldBe(HttpStatusCode.OK);
    }

    /// <summary>The shape of the forgot-password answer, which carries the code only outside a
    /// real deployment.</summary>
    private sealed record ForgotPasswordDevResponse(string Message, string? DevCode);
}
