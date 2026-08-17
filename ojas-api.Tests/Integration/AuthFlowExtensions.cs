using System.Net.Http.Json;
using OjasApi.Models;
using OjasApi.Services;

namespace OjasApi.Tests.Integration;

/// <summary>
/// WebApplicationFactory's HttpClient auto-persists cookies across requests on the same instance
/// (WebApplicationFactoryClientOptions.HandleCookies defaults to true), so once you register/login
/// on a client, its ojas_auth cookie flows automatically on later requests to that same client.
/// The double-submit CSRF token is NOT a cookie the server reads - the app compares the ojas_csrf
/// cookie against an X-CSRF-Token header, so callers must attach the returned token manually to
/// every POST/PUT/PATCH/DELETE.
/// </summary>
public static class AuthFlowExtensions
{
    public static async Task<(AuthResponse Auth, string CsrfToken)> RegisterAsync(
        this HttpClient client, string? fullName = null, string? email = null, string? phone = null, string password = "Passw0rd123!")
    {
        var suffix = Guid.NewGuid().ToString("N")[..8];
        var request = new RegisterRequest(
            fullName ?? $"Test User {suffix}",
            email ?? $"user.{suffix}@example.com",
            phone ?? $"9{suffix.PadRight(9, '0')}",
            password);

        var response = await client.PostAsJsonAsync("/api/auth/register", request);
        response.EnsureSuccessStatusCode();
        var auth = await response.Content.ReadFromJsonAsync<AuthResponse>();
        return (auth!, auth!.CsrfToken!);
    }

    public static async Task<(AuthResponse Auth, string CsrfToken)> LoginAsync(
        this HttpClient client, string email, string password)
    {
        var response = await client.PostAsJsonAsync("/api/auth/login", new LoginRequest(email, password));
        response.EnsureSuccessStatusCode();
        var auth = await response.Content.ReadFromJsonAsync<AuthResponse>();
        return (auth!, auth!.CsrfToken!);
    }

    public static void AttachCsrf(this HttpRequestMessage request, string csrfToken)
    {
        request.Headers.Add("X-CSRF-Token", csrfToken);
    }

    /// <summary>Inserts a pre-hashed admin/delivery user straight into the test database and logs
    /// in as them, sidestepping the admin-only /api/auth/staff endpoint's bootstrap problem.</summary>
    public static async Task<(AuthResponse Auth, string CsrfToken)> SeedAndLoginAsStaffAsync(
        this OjasApiFactory factory, HttpClient client, string role, string? email = null, string password = "Passw0rd123!")
    {
        var suffix = Guid.NewGuid().ToString("N")[..8];
        email ??= $"{role}.{suffix}@example.com";

        await factory.SeedAsync(async db =>
        {
            var user = new User
            {
                FullName = $"Test {role} {suffix}",
                Email = email,
                Phone = $"8{suffix.PadRight(9, '0')}",
                PasswordHash = BCrypt.Net.BCrypt.HashPassword(password),
                Role = role,
                IsEmailVerified = true,
                IsPhoneVerified = true,
            };
            await db.Users.InsertOneAsync(user);
        });

        return await client.LoginAsync(email, password);
    }
}
