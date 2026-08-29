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
        // Checkout is online-payment only since COD was retired, so an unconfigured Cashfree
        // would 503 every order-placing test. The credentials are never really used - the HTTP
        // transport is swapped for FakeCashfreeHandler below - but IsConfigured reads them.
        Environment.SetEnvironmentVariable("Cashfree__ClientId", FakeCashfreeHandler.ClientId);
        Environment.SetEnvironmentVariable("Cashfree__ClientSecret", FakeCashfreeHandler.ClientSecret);
        Environment.SetEnvironmentVariable("Cashfree__Environment", "sandbox");
        // Msg91WidgetVerifier.IsConfigured reads this; the transport is swapped for
        // FakeMsg91WidgetHandler below, same pattern as Cashfree above.
        Environment.SetEnvironmentVariable("Msg91__WidgetAuthKey", FakeMsg91WidgetHandler.WidgetAuthKey);
    }

    public string DatabaseName => _databaseName;

    /// <summary>The stand-in gateway backing this factory's CashfreeService, so a test can
    /// simulate the customer actually completing (or failing) a payment.</summary>
    public FakeCashfreeHandler Cashfree { get; } = new();

    /// <summary>The stand-in for MSG91's OTP Widget verify API, so a test can issue a token as
    /// though a customer had completed the real widget flow for a given phone.</summary>
    public FakeMsg91WidgetHandler Msg91Widget { get; } = new();

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
            // The real CashfreeService is kept (so its request building and response parsing are
            // genuinely exercised) but pointed at a canned transport instead of the live gateway.
            services.AddHttpClient<CashfreeService>()
                .ConfigurePrimaryHttpMessageHandler(() => Cashfree);
            services.AddHttpClient<Msg91WidgetVerifier>()
                .ConfigurePrimaryHttpMessageHandler(() => Msg91Widget);
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

    /// <summary>
    /// Puts a real product in the catalog and hands it back. Orders are priced from the catalog
    /// server-side, so a test that places one needs a product that actually exists — an invented
    /// id with a price attached is exactly the thing the API now refuses, and tests built on one
    /// were only ever passing because the price came from the request.
    /// </summary>
    public async Task<Product> SeedProductAsync(
        decimal price = 100m,
        decimal discount = 0m,
        int? stock = null,
        string name = "Product One",
        string weight = "1kg")
    {
        var product = new Product
        {
            Name = name,
            Description = "Seeded for tests",
            Price = price,
            Discount = discount,
            Category = "Flour",
            Weight = weight,
            StockQuantity = stock,
        };

        await SeedAsync(async db => await db.Products.InsertOneAsync(product));
        return product;
    }
}
