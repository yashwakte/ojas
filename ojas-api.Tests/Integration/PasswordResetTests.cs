using System.Net;
using System.Net.Http.Json;
using MongoDB.Driver;
using OjasApi.Models;
using Shouldly;

namespace OjasApi.Tests.Integration;

[Collection(MongoCollectionFixture.Name)]
public class PasswordResetTests : IDisposable
{
    private const string OldPassword = "Passw0rd123!";
    private const string NewPassword = "BrandNewPassw0rd!";

    private readonly OjasApiFactory _factory;

    public PasswordResetTests(MongoRunnerFixture mongo)
    {
        _factory = new OjasApiFactory(mongo);
    }

    public void Dispose() => _factory.Dispose();

    private static async Task<string?> RequestResetCodeAsync(HttpClient client, string email)
    {
        var response = await client.PostAsJsonAsync(
            "/api/auth/forgot-password", new ForgotPasswordRequest(email, "test-turnstile-token"));
        response.StatusCode.ShouldBe(HttpStatusCode.OK);

        var body = await response.Content.ReadFromJsonAsync<ForgotPasswordDevResponse>();
        return body!.DevCode;
    }

    private async Task<string> SeedStaffAsync(string role, string password = OldPassword)
    {
        var suffix = Guid.NewGuid().ToString("N")[..8];
        var email = $"{role}.{suffix}@example.com";

        await _factory.SeedAsync(async db => await db.Users.InsertOneAsync(new User
        {
            FullName = $"Test {role}",
            Email = email,
            Phone = $"8{suffix.PadRight(9, '0')}",
            PasswordHash = BCrypt.Net.BCrypt.HashPassword(password),
            Role = role,
            IsEmailVerified = true,
            IsPhoneVerified = true,
        }));

        return email;
    }

    [Fact]
    public async Task ACustomer_CanResetTheirPassword_AndSignInWithTheNewOne()
    {
        using var client = _factory.CreateClient();
        var (auth, _) = await client.RegisterAsync(password: OldPassword);

        var code = await RequestResetCodeAsync(client, auth.Email);
        code.ShouldNotBeNull();

        var reset = await client.PostAsJsonAsync(
            "/api/auth/reset-password", new ResetPasswordRequest(auth.Email, code!, NewPassword));
        reset.StatusCode.ShouldBe(HttpStatusCode.OK);

        using var freshClient = _factory.CreateClient();
        var loginWithNew = await freshClient.PostAsJsonAsync(
            "/api/auth/login", new LoginRequest(auth.Email, NewPassword, "test-turnstile-token"));
        loginWithNew.StatusCode.ShouldBe(HttpStatusCode.OK);
    }

    [Fact]
    public async Task TheOldPassword_StopsWorkingAfterAReset()
    {
        using var client = _factory.CreateClient();
        var (auth, _) = await client.RegisterAsync(password: OldPassword);

        var code = await RequestResetCodeAsync(client, auth.Email);
        await client.PostAsJsonAsync(
            "/api/auth/reset-password", new ResetPasswordRequest(auth.Email, code!, NewPassword));

        using var freshClient = _factory.CreateClient();
        var loginWithOld = await freshClient.PostAsJsonAsync(
            "/api/auth/login", new LoginRequest(auth.Email, OldPassword, "test-turnstile-token"));

        loginWithOld.StatusCode.ShouldBe(HttpStatusCode.Unauthorized);
    }

    [Fact]
    public async Task ResettingAPassword_KillsExistingSessions()
    {
        using var client = _factory.CreateClient();
        var (auth, _) = await client.RegisterAsync(password: OldPassword);

        // This client is holding a live session right now.
        var beforeReset = await client.PostAsync("/api/auth/refresh", null);
        beforeReset.StatusCode.ShouldBe(HttpStatusCode.OK);

        var code = await RequestResetCodeAsync(client, auth.Email);
        await client.PostAsJsonAsync(
            "/api/auth/reset-password", new ResetPasswordRequest(auth.Email, code!, NewPassword));

        var afterReset = await client.PostAsync("/api/auth/refresh", null);
        afterReset.StatusCode.ShouldBe(HttpStatusCode.Unauthorized);
    }

    [Fact]
    public async Task ForgotPassword_ForAnUnknownAddress_LooksIdenticalToAKnownOne()
    {
        using var client = _factory.CreateClient();

        var response = await client.PostAsJsonAsync(
            "/api/auth/forgot-password",
            new ForgotPasswordRequest($"nobody.{Guid.NewGuid():N}@example.com", "test-turnstile-token"));

        // Same status and same message as a registered address - only the absence of a code
        // distinguishes them, and that field never ships in Production.
        response.StatusCode.ShouldBe(HttpStatusCode.OK);
        var body = await response.Content.ReadFromJsonAsync<ForgotPasswordDevResponse>();
        body!.DevCode.ShouldBeNull();
        body.Message.ShouldBe("If that email is registered, we've sent a reset code.");
    }

    [Fact]
    public async Task AWrongCode_IsRejected_AndLeavesThePasswordAlone()
    {
        using var client = _factory.CreateClient();
        var (auth, _) = await client.RegisterAsync(password: OldPassword);
        await RequestResetCodeAsync(client, auth.Email);

        var reset = await client.PostAsJsonAsync(
            "/api/auth/reset-password", new ResetPasswordRequest(auth.Email, "000000", NewPassword));
        reset.StatusCode.ShouldBe(HttpStatusCode.BadRequest);

        using var freshClient = _factory.CreateClient();
        var loginWithOld = await freshClient.PostAsJsonAsync(
            "/api/auth/login", new LoginRequest(auth.Email, OldPassword, "test-turnstile-token"));
        loginWithOld.StatusCode.ShouldBe(HttpStatusCode.OK);
    }

    [Fact]
    public async Task ACodeCannotBeRedeemedTwice()
    {
        using var client = _factory.CreateClient();
        var (auth, _) = await client.RegisterAsync(password: OldPassword);
        var code = await RequestResetCodeAsync(client, auth.Email);

        var first = await client.PostAsJsonAsync(
            "/api/auth/reset-password", new ResetPasswordRequest(auth.Email, code!, NewPassword));
        first.StatusCode.ShouldBe(HttpStatusCode.OK);

        var replay = await client.PostAsJsonAsync(
            "/api/auth/reset-password", new ResetPasswordRequest(auth.Email, code!, "YetAnotherPassw0rd!"));
        replay.StatusCode.ShouldBe(HttpStatusCode.BadRequest);
    }

    [Fact]
    public async Task AStaffPasswordReset_DoesNotUnbindTheirDevice()
    {
        var email = await SeedStaffAsync(UserRoles.Delivery);
        using var staffClient = _factory.CreateClient();
        await staffClient.EnrollDeviceAndLoginAsync(email, OldPassword);

        var code = await RequestResetCodeAsync(staffClient, email);
        var reset = await staffClient.PostAsJsonAsync(
            "/api/auth/reset-password", new ResetPasswordRequest(email, code!, NewPassword));
        reset.StatusCode.ShouldBe(HttpStatusCode.OK);

        // Still the bound device, so the new password works here immediately.
        var loginOnBoundDevice = await staffClient.PostAsJsonAsync(
            "/api/auth/login", new LoginRequest(email, NewPassword, "test-turnstile-token"));
        loginOnBoundDevice.StatusCode.ShouldBe(HttpStatusCode.OK);
    }

    [Fact]
    public async Task AStaffPasswordReset_IsStillUseless_FromAnUnboundDevice()
    {
        var email = await SeedStaffAsync(UserRoles.Admin);
        using var staffClient = _factory.CreateClient();
        await staffClient.EnrollDeviceAndLoginAsync(email, OldPassword);

        using var attacker = _factory.CreateClient();
        var code = await RequestResetCodeAsync(attacker, email);
        await attacker.PostAsJsonAsync(
            "/api/auth/reset-password", new ResetPasswordRequest(email, code!, NewPassword));

        // Whoever reset it knows the new password but is on the wrong device - which is the
        // whole point of leaving the binding in place. Email access alone is not enough.
        var login = await attacker.PostAsJsonAsync(
            "/api/auth/login", new LoginRequest(email, NewPassword, "test-turnstile-token"));

        login.StatusCode.ShouldBe(HttpStatusCode.Forbidden);
    }

    [Fact]
    public async Task AReset_MarksAnUnverifiedAccountAsVerified()
    {
        var suffix = Guid.NewGuid().ToString("N")[..8];
        var email = $"unverified.{suffix}@example.com";

        await _factory.SeedAsync(async db => await db.Users.InsertOneAsync(new User
        {
            FullName = "Never Verified",
            Email = email,
            Phone = $"6{suffix.PadRight(9, '0')}",
            PasswordHash = BCrypt.Net.BCrypt.HashPassword(OldPassword),
            Role = UserRoles.Customer,
            IsEmailVerified = false,
            // Phone verification is a separate requirement a password-reset code proves nothing
            // about - true here so this test isolates what it's actually about: that redeeming a
            // reset code counts as proving email control, without also needing phone verified.
            IsPhoneVerified = true,
        }));

        using var client = _factory.CreateClient();
        var code = await RequestResetCodeAsync(client, email);
        await client.PostAsJsonAsync(
            "/api/auth/reset-password", new ResetPasswordRequest(email, code!, NewPassword));

        // Redeeming the code proved control of the address, so login must not now bounce them
        // into the "verify your email" branch.
        var login = await client.PostAsJsonAsync(
            "/api/auth/login", new LoginRequest(email, NewPassword, "test-turnstile-token"));
        login.StatusCode.ShouldBe(HttpStatusCode.OK);
    }

    private record ForgotPasswordDevResponse(string Message, string? DevCode);
}
