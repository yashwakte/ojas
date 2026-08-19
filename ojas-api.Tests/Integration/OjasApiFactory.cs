using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.AspNetCore.TestHost;
using Microsoft.Extensions.DependencyInjection;
using OjasApi.Models;
using OjasApi.Services;
using OjasApi.Tests.TestHelpers;

namespace OjasApi.Tests.Integration;

/// <summary>
/// One WebApplicationFactory&lt;Program&gt; per test class, pointed at a uniquely-named database on
/// the shared embedded Mongo2Go instance. A fresh factory per class means a fresh DI container, which
/// also gives each test class its own in-memory rate-limiter state (the AuthController "auth" policy
/// allows only 5 requests/min) - so keep call counts modest within a class, but don't worry about
/// bleed-over from other test classes.
///
/// Note: Program.cs fires a non-blocking background seed of the demo product catalog on startup
/// (see ProductService.SeedAsync). It is best-effort and its timing relative to your test's first
/// request is not guaranteed, so never assert an exact/absolute product count - filter by a
/// test-unique field (e.g. a GUID-suffixed category or name) or compare counts before/after your
/// own writes instead.
/// </summary>
public sealed class OjasApiFactory : WebApplicationFactory<Program>
{
    private readonly string _connectionString;
    private readonly string _databaseName = $"ojas_test_{Guid.NewGuid():N}";

    public OjasApiFactory(MongoRunnerFixture mongo)
    {
        _connectionString = mongo.Runner.ConnectionString;

        // AuthController issues Secure cookies; HttpClient's CookieContainer silently drops Secure
        // cookies on a non-https BaseAddress (the WebApplicationFactory default is http://localhost).
        ClientOptions.BaseAddress = new Uri("https://localhost");

        // Program.cs reads Jwt:Key/Issuer/Audience into plain local variables at the very top of its
        // top-level statements (before builder.Build()), and JwtBearerOptions closes over those
        // captured strings. IWebHostBuilder.ConfigureAppConfiguration's extra sources are layered in
        // too late to affect that early read, while AuthService (which signs tokens) resolves the
        // *live*, fully-built IConfiguration later - so overriding Jwt:Key via ConfigureAppConfiguration
        // makes the signer and the validator disagree on the key. Environment variables are read by
        // the default config sources WebApplication.CreateBuilder(args) wires up synchronously inside
        // CreateBuilder itself, before Program.cs's own statements run, so they apply everywhere
        // uniformly. Safe to mutate process-wide here because every integration test class shares the
        // "Mongo2Go collection" xUnit collection, which forces them to run serially, never overlapping.
        Environment.SetEnvironmentVariable("Jwt__Key", "test-signing-key-at-least-32-characters-long!!");
        Environment.SetEnvironmentVariable("Jwt__Issuer", "OjasApiTests");
        Environment.SetEnvironmentVariable("Jwt__Audience", "OjasApiTests");
        Environment.SetEnvironmentVariable("MongoDb__ConnectionString", _connectionString);
        Environment.SetEnvironmentVariable("MongoDb__DatabaseName", _databaseName);
        // Program.cs throws at startup if this is unset, same as Jwt:Key/MongoDb:ConnectionString -
        // the value itself is never checked since ITurnstileVerifier is swapped for a fake below.
        Environment.SetEnvironmentVariable("Turnstile__SecretKey", "test-secret-key");
    }

    public string DatabaseName => _databaseName;

    protected override void ConfigureWebHost(IWebHostBuilder builder)
    {
        builder.UseEnvironment("Development");

        // Swap the real Cloudflare-calling verifier for one that always passes, so the suite
        // doesn't depend on a live network call to siteverify for every register/login. Same
        // reasoning for the phone OTP sender - MSG91 isn't configured in this environment (nor
        // in production yet), but phone-login tests still need IsConfigured=true to exercise
        // the flow; the "not configured -> 503" branch is covered by AuthControllerTests instead,
        // where the mock's default (matching the real, currently-unconfigured Msg91 sender) is
        // easier to keep separate from the "configured" happy-path tests.
        builder.ConfigureTestServices(services =>
        {
            services.AddScoped<ITurnstileVerifier, FakeTurnstileVerifier>();
            services.AddScoped<IPhoneOtpSender, FakePhoneOtpSender>();
        });
    }

    /// <summary>Inserts a document directly into this factory's database, bypassing the HTTP API.
    /// Handy for seeding an admin/delivery user so tests can log in as that role without a
    /// chicken-and-egg dependency on the admin-only staff-creation endpoint.</summary>
    public async Task SeedAsync(Func<IMongoDbService, Task> seed)
    {
        using var scope = Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<IMongoDbService>();
        await seed(db);
    }
}
