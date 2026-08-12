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
        var request = new RegisterRequest("Someone Else", first.Email, "9123456780", "Passw0rd!");
        var response = await client2.PostAsJsonAsync("/api/auth/register", request);

        response.StatusCode.ShouldBe(HttpStatusCode.Conflict);
    }

    [Fact]
    public async Task Login_WithWrongPassword_ReturnsUnauthorized()
    {
        var (auth, _) = await _client.RegisterAsync();

        using var client2 = _factory.CreateClient();
        var response = await client2.PostAsJsonAsync("/api/auth/login", new LoginRequest(auth.Email, "WrongPassword1!"));

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
}
