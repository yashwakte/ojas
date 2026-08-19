using System.Net;
using System.Net.Http.Json;
using MongoDB.Driver;
using OjasApi.Models;
using Shouldly;

namespace OjasApi.Tests.Integration;

/// <summary>
/// The break-glass path for when email delivery is what's actually down: an admin can clear a
/// staff account's next device without any message being sent, rather than the previous state
/// where even revoking a lost device still left re-enrollment stuck behind an OTP email.
/// </summary>
[Collection(MongoCollectionFixture.Name)]
public class DevicePreApprovalTests : IDisposable
{
    private const string Password = "Passw0rd123!";

    private readonly OjasApiFactory _factory;

    public DevicePreApprovalTests(MongoRunnerFixture mongo)
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

    private async Task<(string Email, string AdminCsrf, HttpClient AdminClient)> SeedStaffAndAdminAsync(string staffRole)
    {
        var staffEmail = await SeedStaffAsync(staffRole);
        var adminClient = _factory.CreateClient();
        var (_, adminCsrf) = await _factory.SeedAndLoginAsStaffAsync(adminClient, UserRoles.Admin);
        return (staffEmail, adminCsrf, adminClient);
    }

    private static Task<HttpResponseMessage> ApproveNextDeviceAsync(HttpClient adminClient, string csrf, string userId)
    {
        var request = new HttpRequestMessage(HttpMethod.Post, $"/api/auth/staff/{userId}/approve-next-device");
        request.AttachCsrf(csrf);
        return adminClient.SendAsync(request);
    }

    [Fact]
    public async Task PreApprovedDevice_EnrollsOnPasswordAlone_WithNoCodeSent()
    {
        var (staffEmail, adminCsrf, adminClient) = await SeedStaffAndAdminAsync(UserRoles.Delivery);
        var staffId = await GetUserIdAsync(staffEmail);

        var approve = await ApproveNextDeviceAsync(adminClient, adminCsrf, staffId);
        approve.StatusCode.ShouldBe(HttpStatusCode.OK);

        using var staffClient = _factory.CreateClient();

        // No code involved anywhere in this flow - the send-otp step reports the account as
        // already approved instead of emailing anything.
        var sendOtp = await staffClient.PostAsJsonAsync("/api/auth/device/send-otp", new DeviceOtpRequest(staffEmail, Password));
        var sendOtpBody = await sendOtp.Content.ReadFromJsonAsync<DeviceOtpResponse>();
        sendOtpBody!.PreApproved.ShouldBeTrue();
        sendOtpBody.DevCode.ShouldBeNull();

        var enroll = await staffClient.PostAsJsonAsync(
            "/api/auth/device/enroll-preapproved", new PreApprovedEnrollRequest(staffEmail, Password));
        enroll.StatusCode.ShouldBe(HttpStatusCode.OK);

        // The enrolment bound this client as the device, so an ordinary login now succeeds.
        var login = await staffClient.PostAsJsonAsync(
            "/api/auth/login", new LoginRequest(staffEmail, Password, "test-turnstile-token"));
        login.StatusCode.ShouldBe(HttpStatusCode.OK);
    }

    [Fact]
    public async Task EnrollPreApproved_WithNoStandingApproval_IsRejected()
    {
        var staffEmail = await SeedStaffAsync(UserRoles.Admin);
        using var client = _factory.CreateClient();

        var response = await client.PostAsJsonAsync(
            "/api/auth/device/enroll-preapproved", new PreApprovedEnrollRequest(staffEmail, Password));

        response.StatusCode.ShouldBe(HttpStatusCode.BadRequest);
    }

    [Fact]
    public async Task Approval_IsSingleUse_ASecondEnrollAttemptIsRejected()
    {
        var (staffEmail, adminCsrf, adminClient) = await SeedStaffAndAdminAsync(UserRoles.Delivery);
        var staffId = await GetUserIdAsync(staffEmail);
        await ApproveNextDeviceAsync(adminClient, adminCsrf, staffId);

        using var firstDevice = _factory.CreateClient();
        var first = await firstDevice.PostAsJsonAsync(
            "/api/auth/device/enroll-preapproved", new PreApprovedEnrollRequest(staffEmail, Password));
        first.StatusCode.ShouldBe(HttpStatusCode.OK);

        using var secondDevice = _factory.CreateClient();
        var second = await secondDevice.PostAsJsonAsync(
            "/api/auth/device/enroll-preapproved", new PreApprovedEnrollRequest(staffEmail, Password));
        second.StatusCode.ShouldBe(HttpStatusCode.BadRequest);
    }

    [Fact]
    public async Task WrongPassword_DoesNotConsumeTheApproval()
    {
        var (staffEmail, adminCsrf, adminClient) = await SeedStaffAndAdminAsync(UserRoles.Admin);
        var staffId = await GetUserIdAsync(staffEmail);
        await ApproveNextDeviceAsync(adminClient, adminCsrf, staffId);

        using var client = _factory.CreateClient();
        var wrongPassword = await client.PostAsJsonAsync(
            "/api/auth/device/enroll-preapproved", new PreApprovedEnrollRequest(staffEmail, "TotallyWrongPassword1!"));
        wrongPassword.StatusCode.ShouldBe(HttpStatusCode.Unauthorized);

        var rightPassword = await client.PostAsJsonAsync(
            "/api/auth/device/enroll-preapproved", new PreApprovedEnrollRequest(staffEmail, Password));
        rightPassword.StatusCode.ShouldBe(HttpStatusCode.OK);
    }

    [Fact]
    public async Task ApproveNextDevice_IsAdminOnly()
    {
        var deliveryEmail = await SeedStaffAsync(UserRoles.Delivery);
        var otherDeliveryEmail = await SeedStaffAsync(UserRoles.Delivery);
        using var deliveryClient = _factory.CreateClient();
        var (deliveryAuth, deliveryCsrf) = await deliveryClient.EnrollDeviceAndLoginAsync(deliveryEmail, Password);

        var targetId = await GetUserIdAsync(otherDeliveryEmail);
        var response = await ApproveNextDeviceAsync(deliveryClient, deliveryCsrf, targetId);

        response.StatusCode.ShouldBe(HttpStatusCode.Forbidden);
        deliveryAuth.Role.ShouldBe(UserRoles.Delivery);
    }

    [Fact]
    public async Task ApproveNextDevice_OnACustomerAccount_IsRejected()
    {
        using var customerClient = _factory.CreateClient();
        var (customerAuth, _) = await customerClient.RegisterAsync(password: Password);

        using var adminClient = _factory.CreateClient();
        var (_, adminCsrf) = await _factory.SeedAndLoginAsStaffAsync(adminClient, UserRoles.Admin);

        var response = await ApproveNextDeviceAsync(adminClient, adminCsrf, customerAuth.Id);

        response.StatusCode.ShouldBe(HttpStatusCode.NotFound);
    }

    private async Task<string> GetUserIdAsync(string email)
    {
        string? id = null;
        await _factory.SeedAsync(async db =>
        {
            var user = await db.Users.Find(u => u.Email == email).FirstOrDefaultAsync();
            id = user!.Id;
        });
        return id!;
    }

    private record DeviceOtpResponse(string Message, string? DevCode, bool PreApproved);
}
