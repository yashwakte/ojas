using System.Net;
using MongoDB.Driver;
using OjasApi.Models;
using Shouldly;

namespace OjasApi.Tests.Integration;

/// <summary>
/// How long a sign-in lasts, and - more importantly - what stops it lasting forever.
///
/// Sessions used to renew themselves indefinitely: every refresh minted a successor with a full
/// fresh 30-day window, so anyone who kept using the app was never signed out, and a stolen token
/// that kept being used stayed alive for good. Two things changed. Staff sessions are short,
/// because an admin or delivery session reads other people's data and lives on a phone that gets
/// shared and lost. And every session now carries the timestamp of the sign-in it descends from,
/// which is the part a thief holding a live token cannot refresh past.
/// </summary>
[Collection(MongoCollectionFixture.Name)]
public class SessionLifetimeTests : IDisposable
{
    private readonly OjasApiFactory _factory;

    public SessionLifetimeTests(MongoRunnerFixture mongo)
    {
        _factory = new OjasApiFactory(mongo);
    }

    public void Dispose() => _factory.Dispose();

    private async Task<RefreshToken> NewestTokenAsync(string userId)
    {
        RefreshToken? token = null;
        await _factory.SeedAsync(async db =>
        {
            token = await db.RefreshTokens
                .Find(r => r.UserId == userId)
                .SortByDescending(r => r.CreatedAt)
                .FirstOrDefaultAsync();
        });
        token.ShouldNotBeNull();
        return token;
    }

    [Fact]
    public async Task CustomerSession_LastsWeeks_BecauseNobodyIsSignedOutOfAShopTheyAreBrowsing()
    {
        using var client = _factory.CreateClient();
        var (auth, _) = await client.RegisterAsync();

        var token = await NewestTokenAsync(auth.Id);

        (token.ExpiresAt - DateTime.UtcNow).TotalDays.ShouldBeInRange(29, 30);
        token.FamilyStartedAt.ShouldNotBeNull();
    }

    [Fact]
    public async Task StaffSession_LastsOneShift()
    {
        using var client = _factory.CreateClient();
        var (auth, _) = await _factory.SeedAndLoginAsStaffAsync(client, UserRoles.Admin);

        var token = await NewestTokenAsync(auth.Id);

        // Eight hours from sign-in, not eight hours of inactivity: an admin session is a shift.
        (token.ExpiresAt - DateTime.UtcNow).TotalHours.ShouldBeInRange(7.5, 8);
    }

    [Fact]
    public async Task Refreshing_DoesNotExtendTheSessionPastItsCeiling()
    {
        using var client = _factory.CreateClient();
        var (auth, _) = await client.RegisterAsync();

        var original = await NewestTokenAsync(auth.Id);

        // Pretend this sign-in happened 89 days ago. The rolling window would happily hand out
        // another 30 days; the ceiling is what must win.
        var signedInAt = DateTime.UtcNow.AddDays(-89);
        await _factory.SeedAsync(async db =>
        {
            await db.RefreshTokens.UpdateOneAsync(
                r => r.TokenHash == original.TokenHash,
                Builders<RefreshToken>.Update.Set(r => r.FamilyStartedAt, signedInAt));
        });

        var refreshed = await client.PostAsync("/api/auth/refresh", null);
        refreshed.StatusCode.ShouldBe(HttpStatusCode.OK);

        var successor = await NewestTokenAsync(auth.Id);
        successor.FamilyStartedAt!.Value.ShouldBe(signedInAt, TimeSpan.FromSeconds(2));
        // One day of headroom left out of ninety, not a fresh thirty.
        (successor.ExpiresAt - DateTime.UtcNow).TotalDays.ShouldBeLessThan(2);
    }

    [Fact]
    public async Task ASessionPastItsCeiling_IsRefusedAndItsWholeFamilyRevoked()
    {
        using var client = _factory.CreateClient();
        var (auth, _) = await client.RegisterAsync();
        var original = await NewestTokenAsync(auth.Id);

        // Past the ceiling, but the token's own stored expiry left deliberately in the future -
        // so this proves the ceiling is enforced in its own right, not merely implied by expiry.
        await _factory.SeedAsync(async db =>
        {
            await db.RefreshTokens.UpdateOneAsync(
                r => r.TokenHash == original.TokenHash,
                Builders<RefreshToken>.Update
                    .Set(r => r.FamilyStartedAt, DateTime.UtcNow.AddDays(-91))
                    .Set(r => r.ExpiresAt, DateTime.UtcNow.AddDays(10)));
        });

        var refreshed = await client.PostAsync("/api/auth/refresh", null);
        refreshed.StatusCode.ShouldBe(HttpStatusCode.Unauthorized);

        long surviving = 0;
        await _factory.SeedAsync(async db =>
        {
            surviving = await db.RefreshTokens.CountDocumentsAsync(r => r.UserId == auth.Id);
        });
        surviving.ShouldBe(0);
    }

    [Fact]
    public async Task PromotingSomeoneToStaff_EndsTheCustomerSessionTheyAlreadyHad()
    {
        using var client = _factory.CreateClient();
        var (auth, _) = await client.RegisterAsync();

        // Signed in as an ordinary customer, so this session began with a 30-day window.
        var asCustomer = await NewestTokenAsync(auth.Id);
        (asCustomer.ExpiresAt - DateTime.UtcNow).TotalDays.ShouldBeGreaterThan(29);

        await _factory.SeedAsync(async db =>
        {
            await db.Users.UpdateOneAsync(
                u => u.Id == auth.Id,
                Builders<User>.Update.Set(u => u.Role, UserRoles.Admin));
        });

        // Stronger than merely re-pricing the session against the new role: a staff session has
        // to be pinned to an enrolled device, and a customer's never was, so the old session
        // cannot continue at all. The promoted account signs in again and enrols a device, which
        // is exactly what should happen - a month-long, device-less admin session is the hole
        // that would otherwise open on every promotion.
        var refreshed = await client.PostAsync("/api/auth/refresh", null);
        refreshed.StatusCode.ShouldBe(HttpStatusCode.Unauthorized);
    }

    [Fact]
    public async Task ASessionWrittenBeforeCeilingsExisted_IsNotSignedOutImmediately()
    {
        using var client = _factory.CreateClient();
        var (auth, _) = await client.RegisterAsync();
        var original = await NewestTokenAsync(auth.Id);

        // Rows predating the field have no sign-in timestamp to inherit. Those start their clock
        // at the next rotation rather than being treated as infinitely old, so shipping this does
        // not sign out everyone who is currently logged in.
        await _factory.SeedAsync(async db =>
        {
            await db.RefreshTokens.UpdateOneAsync(
                r => r.TokenHash == original.TokenHash,
                Builders<RefreshToken>.Update.Set(r => r.FamilyStartedAt, (DateTime?)null));
        });

        var refreshed = await client.PostAsync("/api/auth/refresh", null);
        refreshed.StatusCode.ShouldBe(HttpStatusCode.OK);

        var successor = await NewestTokenAsync(auth.Id);
        successor.FamilyStartedAt.ShouldNotBeNull();
        (successor.ExpiresAt - DateTime.UtcNow).TotalDays.ShouldBeInRange(29, 30);
    }
}
