using System.Net;
using System.Net.Http.Json;
using MongoDB.Driver;
using OjasApi.Models;
using Shouldly;

namespace OjasApi.Tests.Integration;

/// <summary>
/// Staff accounts (admin and delivery) may only hold a session on the one device bound to them.
/// Each HttpClient created by the factory has its own cookie jar, which is what makes "a
/// different device" expressible here - a second client simply doesn't hold the ojas_device
/// cookie the first one was given.
/// </summary>
[Collection(MongoCollectionFixture.Name)]
public class DeviceRestrictionTests : IDisposable
{
    private const string Password = "Passw0rd123!";

    private readonly OjasApiFactory _factory;

    public DeviceRestrictionTests(MongoRunnerFixture mongo)
    {
        _factory = new OjasApiFactory(mongo);
    }

    public void Dispose() => _factory.Dispose();

    private async Task<string> SeedStaffAsync(string role)
    {
        var suffix = Guid.NewGuid().ToString("N")[..8];
        var email = $"{role}.{suffix}@example.com";

        await _factory.SeedAsync(async db => await db.Users.InsertOneAsync(new User
        {
            FullName = $"Test {role}",
            Email = email,
            Phone = $"8{suffix.PadRight(9, '0')}",
            PasswordHash = BCrypt.Net.BCrypt.HashPassword(Password),
            Role = role,
            IsEmailVerified = true,
            IsPhoneVerified = true,
        }));

        return email;
    }

    private static async Task<HttpResponseMessage> LoginAsync(HttpClient client, string email, string? password = null) =>
        await client.PostAsJsonAsync(
            "/api/auth/login", new LoginRequest(email, password ?? Password, "test-turnstile-token"));

    [Theory]
    [InlineData(UserRoles.Admin)]
    [InlineData(UserRoles.Delivery)]
    public async Task StaffLogin_FromAnUnknownDevice_IsRefusedEvenWithTheCorrectPassword(string role)
    {
        var email = await SeedStaffAsync(role);
        using var client = _factory.CreateClient();

        var response = await LoginAsync(client, email);

        response.StatusCode.ShouldBe(HttpStatusCode.Forbidden);
        var body = await response.Content.ReadFromJsonAsync<DeviceEnrollmentRequiredResponse>();
        body!.NeedsDeviceEnrollment.ShouldBeTrue();
    }

    [Fact]
    public async Task CustomerLogin_IsUnaffected_ByDeviceRestriction()
    {
        using var registerClient = _factory.CreateClient();
        var (auth, _) = await registerClient.RegisterAsync(password: Password);

        // A completely separate client - no device cookie anywhere in its jar.
        using var otherDevice = _factory.CreateClient();
        var response = await LoginAsync(otherDevice, auth.Email);

        response.StatusCode.ShouldBe(HttpStatusCode.OK);
    }

    [Fact]
    public async Task EnrollingADevice_LetsThatSameClientLogInNormallyAfterwards()
    {
        var email = await SeedStaffAsync(UserRoles.Admin);
        using var client = _factory.CreateClient();

        await client.EnrollDeviceAndLoginAsync(email, Password);

        // The enrolment response set ojas_device on this client, so an ordinary login now passes.
        var response = await LoginAsync(client, email);
        response.StatusCode.ShouldBe(HttpStatusCode.OK);
    }

    /// <summary>
    /// A shop computer shared by an admin and a delivery partner. Each approves it once; after
    /// that both sign in freely and switching between them never asks for another code. The cap
    /// is one device per person, so sharing a browser must not make the two accounts evict each
    /// other from the single device cookie.
    /// </summary>
    [Fact]
    public async Task TwoStaffAccounts_CanShareOneBrowser_EachApprovingItOnlyOnce()
    {
        var adminEmail = await SeedStaffAsync(UserRoles.Admin);
        var deliveryEmail = await SeedStaffAsync(UserRoles.Delivery);

        // One client == one browser: a single cookie jar holding a single ojas_device cookie.
        using var sharedBrowser = _factory.CreateClient();

        await sharedBrowser.EnrollDeviceAndLoginAsync(adminEmail, Password);
        await sharedBrowser.EnrollDeviceAndLoginAsync(deliveryEmail, Password);

        // Back to the admin - the delivery approval must not have unbound them.
        var adminAgain = await LoginAsync(sharedBrowser, adminEmail);
        adminAgain.StatusCode.ShouldBe(HttpStatusCode.OK);

        var deliveryAgain = await LoginAsync(sharedBrowser, deliveryEmail);
        deliveryAgain.StatusCode.ShouldBe(HttpStatusCode.OK);

        // And once more, to prove it is stable rather than just alternating correctly once.
        var adminThirdTime = await LoginAsync(sharedBrowser, adminEmail);
        adminThirdTime.StatusCode.ShouldBe(HttpStatusCode.OK);
    }

    [Fact]
    public async Task SharingABrowser_DoesNotLetOneStaffMemberInheritAnothersApproval()
    {
        var adminEmail = await SeedStaffAsync(UserRoles.Admin);
        var deliveryEmail = await SeedStaffAsync(UserRoles.Delivery);

        using var sharedBrowser = _factory.CreateClient();
        await sharedBrowser.EnrollDeviceAndLoginAsync(adminEmail, Password);

        // The browser is trusted for the admin, but the delivery partner has never approved it,
        // so they still have to prove control of their own email.
        var deliveryFirstAttempt = await LoginAsync(sharedBrowser, deliveryEmail);

        deliveryFirstAttempt.StatusCode.ShouldBe(HttpStatusCode.Forbidden);
    }

    [Fact]
    public async Task RevokingOneStaffMembersDevice_LeavesTheOtherSharingItUnaffected()
    {
        var deliveryEmail = await SeedStaffAsync(UserRoles.Delivery);
        using var sharedBrowser = _factory.CreateClient();
        var (deliveryAuth, _) = await sharedBrowser.EnrollDeviceAndLoginAsync(deliveryEmail, Password);

        using var adminClient = _factory.CreateClient();
        var (_, adminCsrf) = await _factory.SeedAndLoginAsStaffAsync(adminClient, UserRoles.Admin);

        // The admin also uses the shared browser.
        var adminEmail = await SeedStaffAsync(UserRoles.Admin);
        await sharedBrowser.EnrollDeviceAndLoginAsync(adminEmail, Password);

        var revoke = new HttpRequestMessage(HttpMethod.Delete, $"/api/auth/staff/{deliveryAuth.Id}/devices");
        revoke.AttachCsrf(adminCsrf);
        (await adminClient.SendAsync(revoke)).StatusCode.ShouldBe(HttpStatusCode.NoContent);

        var deliveryBlocked = await LoginAsync(sharedBrowser, deliveryEmail);
        deliveryBlocked.StatusCode.ShouldBe(HttpStatusCode.Forbidden);

        var adminStillFine = await LoginAsync(sharedBrowser, adminEmail);
        adminStillFine.StatusCode.ShouldBe(HttpStatusCode.OK);
    }

    [Fact]
    public async Task ASecondDevice_StillCannotLogIn_AfterTheFirstOneIsEnrolled()
    {
        var email = await SeedStaffAsync(UserRoles.Admin);
        using var enrolled = _factory.CreateClient();
        await enrolled.EnrollDeviceAndLoginAsync(email, Password);

        using var attacker = _factory.CreateClient();
        var response = await LoginAsync(attacker, email);

        response.StatusCode.ShouldBe(HttpStatusCode.Forbidden);
    }

    [Fact]
    public async Task EnrollingASecondDevice_ReplacesTheFirst_AndKillsItsSession()
    {
        var email = await SeedStaffAsync(UserRoles.Delivery);
        using var firstDevice = _factory.CreateClient();
        await firstDevice.EnrollDeviceAndLoginAsync(email, Password);

        // The cap is one device, so enrolling anywhere else must evict the original.
        using var secondDevice = _factory.CreateClient();
        await secondDevice.EnrollDeviceAndLoginAsync(email, Password);

        var evictedRefresh = await firstDevice.PostAsync("/api/auth/refresh", null);
        evictedRefresh.StatusCode.ShouldBe(HttpStatusCode.Unauthorized);

        var survivingRefresh = await secondDevice.PostAsync("/api/auth/refresh", null);
        survivingRefresh.StatusCode.ShouldBe(HttpStatusCode.OK);
    }

    [Fact]
    public async Task StaffRefreshToken_IsUseless_WithoutTheDeviceCookieItWasIssuedTo()
    {
        var email = await SeedStaffAsync(UserRoles.Admin);
        using var enrolled = _factory.CreateClient();

        // Driven manually rather than through the helper so the raw Set-Cookie headers are
        // visible - the client's own cookie jar isn't reachable from here.
        var otpResponse = await enrolled.PostAsJsonAsync("/api/auth/device/send-otp", new DeviceOtpRequest(email, Password));
        var otp = await otpResponse.Content.ReadFromJsonAsync<DeviceOtpDevResponse>();
        var enrollResponse = await enrolled.PostAsJsonAsync(
            "/api/auth/device/enroll", new EnrollDeviceRequest(email, Password, otp!.DevCode!));
        enrollResponse.EnsureSuccessStatusCode();

        var refreshCookie = ReadSetCookie(enrollResponse, "ojas_refresh");
        refreshCookie.ShouldNotBeNull();

        // Replay the stolen refresh token from a jar that has no ojas_device cookie - the exact
        // shape of a token lifted off a staff session and used on the attacker's own machine.
        using var thief = _factory.CreateClient();
        var request = new HttpRequestMessage(HttpMethod.Post, "/api/auth/refresh");
        request.Headers.Add("Cookie", $"ojas_refresh={refreshCookie}");
        var response = await thief.SendAsync(request);

        response.StatusCode.ShouldBe(HttpStatusCode.Unauthorized);
    }

    [Fact]
    public async Task AdminRevokingADevice_ForcesThatStaffMemberToEnrollAgain()
    {
        var deliveryEmail = await SeedStaffAsync(UserRoles.Delivery);
        using var deliveryClient = _factory.CreateClient();
        var (deliveryAuth, _) = await deliveryClient.EnrollDeviceAndLoginAsync(deliveryEmail, Password);

        using var adminClient = _factory.CreateClient();
        var (_, adminCsrf) = await _factory.SeedAndLoginAsStaffAsync(adminClient, UserRoles.Admin);

        var listResponse = await adminClient.GetAsync($"/api/auth/staff/{deliveryAuth.Id}/devices");
        listResponse.StatusCode.ShouldBe(HttpStatusCode.OK);
        var devices = await listResponse.Content.ReadFromJsonAsync<List<StaffDeviceResponse>>();
        devices!.Count.ShouldBe(1);

        var revoke = new HttpRequestMessage(HttpMethod.Delete, $"/api/auth/staff/{deliveryAuth.Id}/devices");
        revoke.AttachCsrf(adminCsrf);
        var revokeResponse = await adminClient.SendAsync(revoke);
        revokeResponse.StatusCode.ShouldBe(HttpStatusCode.NoContent);

        var loginAfterRevoke = await LoginAsync(deliveryClient, deliveryEmail);
        loginAfterRevoke.StatusCode.ShouldBe(HttpStatusCode.Forbidden);
    }

    [Fact]
    public async Task DeviceListing_IsAdminOnly()
    {
        var deliveryEmail = await SeedStaffAsync(UserRoles.Delivery);
        using var deliveryClient = _factory.CreateClient();
        var (deliveryAuth, _) = await deliveryClient.EnrollDeviceAndLoginAsync(deliveryEmail, Password);

        // A delivery partner must not be able to enumerate anyone's devices, including their own.
        var response = await deliveryClient.GetAsync($"/api/auth/staff/{deliveryAuth.Id}/devices");

        response.StatusCode.ShouldBe(HttpStatusCode.Forbidden);
    }

    [Fact]
    public async Task Enroll_WithAWrongCode_IsRejected_AndBindsNothing()
    {
        var email = await SeedStaffAsync(UserRoles.Admin);
        using var client = _factory.CreateClient();
        await client.PostAsJsonAsync("/api/auth/device/send-otp", new DeviceOtpRequest(email, Password));

        var response = await client.PostAsJsonAsync(
            "/api/auth/device/enroll", new EnrollDeviceRequest(email, Password, "000000"));

        response.StatusCode.ShouldBe(HttpStatusCode.BadRequest);

        var stillBlocked = await LoginAsync(client, email);
        stillBlocked.StatusCode.ShouldBe(HttpStatusCode.Forbidden);
    }

    [Fact]
    public async Task SendDeviceOtp_WithTheWrongPassword_ReturnsTheGenericResponseWithNoCode()
    {
        var email = await SeedStaffAsync(UserRoles.Admin);
        using var client = _factory.CreateClient();

        var response = await client.PostAsJsonAsync(
            "/api/auth/device/send-otp", new DeviceOtpRequest(email, "TotallyWrongPassword1!"));

        // Deliberately 200 rather than 401 - the response must not confirm whether the account
        // exists. What gives it away as a no-op is that no code comes back.
        response.StatusCode.ShouldBe(HttpStatusCode.OK);
        var body = await response.Content.ReadFromJsonAsync<DeviceOtpDevResponse>();
        body!.DevCode.ShouldBeNull();
    }

    [Fact]
    public async Task StaffLogin_IsCaseInsensitiveOnEmail_JustLikeCustomerLogin()
    {
        var email = await SeedStaffAsync(UserRoles.Delivery);
        using var client = _factory.CreateClient();

        var response = await client.PostAsJsonAsync(
            "/api/auth/device/send-otp", new DeviceOtpRequest(email.ToUpperInvariant(), Password));

        var body = await response.Content.ReadFromJsonAsync<DeviceOtpDevResponse>();
        body!.DevCode.ShouldNotBeNull();
    }

    [Fact]
    public async Task BootstrapAdmin_BindsTheCallingDevice_SoTheFirstAdminNeverNeedsToEnroll()
    {
        using var client = _factory.CreateClient();
        var suffix = Guid.NewGuid().ToString("N")[..8];
        var request = new RegisterRequest(
            "First Admin", $"first.admin.{suffix}@example.com", $"7{suffix.PadRight(9, '0')}", Password, "test-turnstile-token");

        var bootstrap = await client.PostAsJsonAsync("/api/auth/bootstrap-admin", request);
        bootstrap.StatusCode.ShouldBe(HttpStatusCode.OK);

        var loginAgain = await LoginAsync(client, request.Email);
        loginAgain.StatusCode.ShouldBe(HttpStatusCode.OK);
    }

    private static string? ReadSetCookie(HttpResponseMessage response, string name)
    {
        if (!response.Headers.TryGetValues("Set-Cookie", out var cookies))
            return null;

        return cookies
            .Select(c => c.Split(';')[0])
            .Where(c => c.StartsWith($"{name}=", StringComparison.Ordinal))
            .Select(c => c[(name.Length + 1)..])
            .FirstOrDefault();
    }

    private record DeviceEnrollmentRequiredResponse(string Message, bool NeedsDeviceEnrollment, string Email);
    private record DeviceOtpDevResponse(string Message, string? DevCode);
}
