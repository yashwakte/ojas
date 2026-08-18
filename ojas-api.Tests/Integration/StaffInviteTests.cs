using System.Net;
using System.Net.Http.Json;
using MongoDB.Driver;
using OjasApi.Models;
using Shouldly;

namespace OjasApi.Tests.Integration;

/// <summary>
/// Staff onboarding by invite: the admin creates a dormant account and the staff member sets
/// their own password by opening a single-use link sent to their address. Replaces the old
/// hand-off where an admin invented a temporary password and passed it along, which meant the
/// admin knew every staff credential and nothing forced it to be changed.
/// </summary>
[Collection(MongoCollectionFixture.Name)]
public class StaffInviteTests : IDisposable
{
    private const string ChosenPassword = "MyOwnPassw0rd!";

    private readonly OjasApiFactory _factory;

    public StaffInviteTests(MongoRunnerFixture mongo)
    {
        _factory = new OjasApiFactory(mongo);
    }

    public void Dispose() => _factory.Dispose();

    private async Task<(string Email, string Token, string UserId)> InviteStaffAsync(
        HttpClient adminClient, string adminCsrf, string role = UserRoles.Delivery)
    {
        var suffix = Guid.NewGuid().ToString("N")[..8];
        var email = $"invited.{suffix}@example.com";

        var create = new HttpRequestMessage(HttpMethod.Post, "/api/auth/staff")
        {
            Content = JsonContent.Create(new CreateStaffRequest(
                $"Invited {suffix}", email, $"7{suffix.PadRight(9, '0')}", role)),
        };
        create.AttachCsrf(adminCsrf);

        var response = await adminClient.SendAsync(create);
        response.StatusCode.ShouldBe(HttpStatusCode.OK);

        var body = await response.Content.ReadFromJsonAsync<CreateStaffDevResponse>();
        body!.DevInviteToken.ShouldNotBeNull();
        body.InvitePending.ShouldBeTrue();

        return (email, body.DevInviteToken!, body.Id);
    }

    private async Task<(HttpClient Admin, string Csrf)> AdminClientAsync()
    {
        var adminClient = _factory.CreateClient();
        var (_, csrf) = await _factory.SeedAndLoginAsStaffAsync(adminClient, UserRoles.Admin);
        return (adminClient, csrf);
    }

    [Fact]
    public async Task CreatingStaff_LeavesTheAccountDormant_WithNoPasswordSet()
    {
        var (adminClient, csrf) = await AdminClientAsync();
        using var _ = adminClient;

        var (email, _, _) = await InviteStaffAsync(adminClient, csrf);

        await _factory.SeedAsync(async db =>
        {
            var user = await db.Users.Find(u => u.Email == email).FirstOrDefaultAsync();
            user.ShouldNotBeNull();
            user!.PasswordHash.ShouldBeEmpty();
        });
    }

    [Fact]
    public async Task ADormantAccount_CannotBeSignedIntoWithAnyPassword()
    {
        var (adminClient, csrf) = await AdminClientAsync();
        using var _ = adminClient;
        var (email, _, _) = await InviteStaffAsync(adminClient, csrf);

        using var attacker = _factory.CreateClient();

        // The empty hash must read as "no password", never as "matches anything" - and it must
        // not blow up either, since BCrypt.Verify throws on an empty hash.
        var response = await attacker.PostAsJsonAsync(
            "/api/auth/login", new LoginRequest(email, "", "test-turnstile-token"));
        response.StatusCode.ShouldBeOneOf(HttpStatusCode.Unauthorized, HttpStatusCode.BadRequest);

        var guess = await attacker.PostAsJsonAsync(
            "/api/auth/login", new LoginRequest(email, "AnyOldPassw0rd!", "test-turnstile-token"));
        guess.StatusCode.ShouldBe(HttpStatusCode.Unauthorized);
    }

    [Fact]
    public async Task AcceptingAnInvite_SetsThePassword_BindsTheDevice_AndSignsThemIn()
    {
        var (adminClient, csrf) = await AdminClientAsync();
        using var _ = adminClient;
        var (email, token, _) = await InviteStaffAsync(adminClient, csrf);

        using var staffBrowser = _factory.CreateClient();
        var accept = await staffBrowser.PostAsJsonAsync(
            "/api/auth/accept-invite", new AcceptInviteRequest(token, ChosenPassword));
        accept.StatusCode.ShouldBe(HttpStatusCode.OK);

        var auth = await accept.Content.ReadFromJsonAsync<AuthResponse>();
        auth!.Email.ShouldBe(email);
        auth.Role.ShouldBe(UserRoles.Delivery);

        // Accepting the invite proved control of the address, so no separate device approval is
        // needed - this browser is already the bound one.
        var login = await staffBrowser.PostAsJsonAsync(
            "/api/auth/login", new LoginRequest(email, ChosenPassword, "test-turnstile-token"));
        login.StatusCode.ShouldBe(HttpStatusCode.OK);
    }

    [Fact]
    public async Task AcceptingOnOneDevice_StillLeavesEveryOtherDeviceLockedOut()
    {
        var (adminClient, csrf) = await AdminClientAsync();
        using var _ = adminClient;
        var (email, token, _) = await InviteStaffAsync(adminClient, csrf);

        using var staffBrowser = _factory.CreateClient();
        await staffBrowser.PostAsJsonAsync(
            "/api/auth/accept-invite", new AcceptInviteRequest(token, ChosenPassword));

        using var otherDevice = _factory.CreateClient();
        var login = await otherDevice.PostAsJsonAsync(
            "/api/auth/login", new LoginRequest(email, ChosenPassword, "test-turnstile-token"));

        login.StatusCode.ShouldBe(HttpStatusCode.Forbidden);
    }

    [Fact]
    public async Task AnInviteCanOnlyBeUsedOnce()
    {
        var (adminClient, csrf) = await AdminClientAsync();
        using var _ = adminClient;
        var (_, token, _) = await InviteStaffAsync(adminClient, csrf);

        using var first = _factory.CreateClient();
        (await first.PostAsJsonAsync("/api/auth/accept-invite", new AcceptInviteRequest(token, ChosenPassword)))
            .StatusCode.ShouldBe(HttpStatusCode.OK);

        using var replay = _factory.CreateClient();
        var second = await replay.PostAsJsonAsync(
            "/api/auth/accept-invite", new AcceptInviteRequest(token, "DifferentPassw0rd!"));

        second.StatusCode.ShouldBe(HttpStatusCode.BadRequest);
    }

    [Fact]
    public async Task AnUnknownToken_IsRejected()
    {
        using var client = _factory.CreateClient();

        var response = await client.PostAsJsonAsync(
            "/api/auth/accept-invite", new AcceptInviteRequest("not-a-real-token", ChosenPassword));

        response.StatusCode.ShouldBe(HttpStatusCode.BadRequest);
    }

    [Fact]
    public async Task AnExpiredInvite_IsRejected()
    {
        var (adminClient, csrf) = await AdminClientAsync();
        using var _ = adminClient;
        var (_, token, userId) = await InviteStaffAsync(adminClient, csrf);

        // Push it into the past rather than waiting 48 hours.
        await _factory.SeedAsync(async db => await db.StaffInvites.UpdateOneAsync(
            Builders<StaffInvite>.Filter.Eq(i => i.UserId, userId),
            Builders<StaffInvite>.Update.Set(i => i.ExpiresAt, DateTime.UtcNow.AddMinutes(-1))));

        using var staffBrowser = _factory.CreateClient();
        var accept = await staffBrowser.PostAsJsonAsync(
            "/api/auth/accept-invite", new AcceptInviteRequest(token, ChosenPassword));

        accept.StatusCode.ShouldBe(HttpStatusCode.BadRequest);
    }

    [Fact]
    public async Task ResendingAnInvite_InvalidatesTheLinkFromTheEarlierEmail()
    {
        var (adminClient, csrf) = await AdminClientAsync();
        using var _ = adminClient;
        var (_, originalToken, userId) = await InviteStaffAsync(adminClient, csrf);

        var resend = new HttpRequestMessage(HttpMethod.Post, $"/api/auth/staff/{userId}/invite");
        resend.AttachCsrf(csrf);
        var resendResponse = await adminClient.SendAsync(resend);
        resendResponse.StatusCode.ShouldBe(HttpStatusCode.OK);

        var body = await resendResponse.Content.ReadFromJsonAsync<ResendInviteDevResponse>();
        body!.DevInviteToken.ShouldNotBeNull();
        body.DevInviteToken.ShouldNotBe(originalToken);

        using var staffBrowser = _factory.CreateClient();
        var withOldLink = await staffBrowser.PostAsJsonAsync(
            "/api/auth/accept-invite", new AcceptInviteRequest(originalToken, ChosenPassword));
        withOldLink.StatusCode.ShouldBe(HttpStatusCode.BadRequest);

        var withNewLink = await staffBrowser.PostAsJsonAsync(
            "/api/auth/accept-invite", new AcceptInviteRequest(body.DevInviteToken!, ChosenPassword));
        withNewLink.StatusCode.ShouldBe(HttpStatusCode.OK);
    }

    [Fact]
    public async Task AnAlreadySetUpAccount_CannotBeResetViaResend()
    {
        var (adminClient, csrf) = await AdminClientAsync();
        using var _ = adminClient;
        var (_, token, userId) = await InviteStaffAsync(adminClient, csrf);

        using var staffBrowser = _factory.CreateClient();
        await staffBrowser.PostAsJsonAsync("/api/auth/accept-invite", new AcceptInviteRequest(token, ChosenPassword));

        // Otherwise an admin could quietly re-issue a link and take over a live staff account.
        var resend = new HttpRequestMessage(HttpMethod.Post, $"/api/auth/staff/{userId}/invite");
        resend.AttachCsrf(csrf);
        var resendResponse = await adminClient.SendAsync(resend);

        resendResponse.StatusCode.ShouldBe(HttpStatusCode.BadRequest);
    }

    [Fact]
    public async Task TheInvitePreview_NamesTheAccountBeingActivated()
    {
        var (adminClient, csrf) = await AdminClientAsync();
        using var _ = adminClient;
        var (email, token, _) = await InviteStaffAsync(adminClient, csrf);

        using var staffBrowser = _factory.CreateClient();
        var response = await staffBrowser.GetAsync($"/api/auth/invite?token={Uri.EscapeDataString(token)}");

        response.StatusCode.ShouldBe(HttpStatusCode.OK);
        var preview = await response.Content.ReadFromJsonAsync<InvitePreviewResponse>();
        preview!.Email.ShouldBe(email);
        preview.Role.ShouldBe(UserRoles.Delivery);
    }

    [Fact]
    public async Task StaffCreation_IsStillAdminOnly()
    {
        using var customerClient = _factory.CreateClient();
        var (_, csrf) = await customerClient.RegisterAsync();

        var create = new HttpRequestMessage(HttpMethod.Post, "/api/auth/staff")
        {
            Content = JsonContent.Create(new CreateStaffRequest(
                "Sneaky", "sneaky@example.com", "7000000123", UserRoles.Admin)),
        };
        create.AttachCsrf(csrf);

        var response = await customerClient.SendAsync(create);

        response.StatusCode.ShouldBe(HttpStatusCode.Forbidden);
    }

    private record CreateStaffDevResponse(
        string Id, string FullName, string Email, string Phone, string Role, bool InvitePending, string? DevInviteToken);

    private record ResendInviteDevResponse(string Message, string? DevInviteToken);
}
