using System.Globalization;
using System.Net;
using System.Security.Cryptography;
using System.Text;
using Microsoft.Extensions.Configuration;
using OjasApi.Models;
using OjasApi.Services;
using Shouldly;

namespace OjasApi.Tests.Services;

public class CashfreeServiceTests
{
    private const string ClientSecret = "test-cashfree-secret";

    private sealed class FakeHandler(Func<HttpRequestMessage, HttpResponseMessage> respond) : HttpMessageHandler
    {
        protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancellationToken) =>
            Task.FromResult(respond(request));
    }

    private static IConfiguration ConfiguredSettings(string environment = "sandbox") =>
        new ConfigurationBuilder()
            .AddInMemoryCollection(new Dictionary<string, string?>
            {
                ["Cashfree:Environment"] = environment,
                ["Cashfree:ClientId"] = "test-client-id",
                ["Cashfree:ClientSecret"] = ClientSecret,
            })
            .Build();

    private static IConfiguration UnconfiguredSettings() => new ConfigurationBuilder().Build();

    private static CashfreeService MakeService(Func<HttpRequestMessage, HttpResponseMessage> respond, IConfiguration? config = null) =>
        new(new HttpClient(new FakeHandler(respond)), config ?? ConfiguredSettings());

    private static Order MakeOrder() => new()
    {
        Id = "507f1f77bcf86cd799439011",
        UserId = "user-1",
        FullName = "Jane Doe",
        Phone = "9123456789",
        Address = "123 Main St",
        TotalAmount = 250m,
    };

    private static string ComputeSignature(string body, string timestamp, string secret)
    {
        using var hmac = new HMACSHA256(Encoding.UTF8.GetBytes(secret));
        var hash = hmac.ComputeHash(Encoding.UTF8.GetBytes(timestamp + body));
        return Convert.ToBase64String(hash);
    }

    // ---------- Environment ----------

    /// <summary>The mode the browser is told to load its checkout SDK in. It has to be derived
    /// from the same setting that picks the API base URL — if the two could ever disagree, the
    /// server would raise a payment session in one environment and the SDK would try to open it
    /// in the other, which fails every time.</summary>
    [Theory]
    [InlineData("production", "production")]
    [InlineData("PRODUCTION", "production")]
    [InlineData("sandbox", "sandbox")]
    [InlineData("", "sandbox")]
    [InlineData(null, "sandbox")]
    public void Mode_IsProduction_OnlyWhenExplicitlyConfiguredSo(string? configured, string expected)
    {
        var config = new ConfigurationBuilder()
            .AddInMemoryCollection(new Dictionary<string, string?> { ["Cashfree:Environment"] = configured })
            .Build();

        new CashfreeService(new HttpClient(), config).Mode.ShouldBe(expected);
    }

    [Theory]
    [InlineData("production", "api.cashfree.com")]
    [InlineData("sandbox", "sandbox.cashfree.com")]
    public async Task CreateOrderAsync_CallsTheHostMatchingTheConfiguredEnvironment(string environment, string expectedHost)
    {
        Uri? requested = null;
        var service = MakeService(
            request =>
            {
                requested = request.RequestUri;
                return new HttpResponseMessage(HttpStatusCode.OK)
                {
                    Content = new StringContent(
                        """{"cf_order_id":"cf_order_1","payment_session_id":"session_abc"}""",
                        Encoding.UTF8, "application/json"),
                };
            },
            ConfiguredSettings(environment));

        await service.CreateOrderAsync(MakeOrder());

        requested!.Host.ShouldBe(expectedHost);
    }

    // ---------- EnsureCredentialsMatchEnvironment ----------

    private static IConfiguration Credentials(string? environment, string? clientId) =>
        new ConfigurationBuilder()
            .AddInMemoryCollection(new Dictionary<string, string?>
            {
                ["Cashfree:Environment"] = environment,
                ["Cashfree:ClientId"] = clientId,
            })
            .Build();

    /// <summary>The half-done go-live: the environment was flipped but the sandbox key was left
    /// behind. It authenticates against nothing on the live API, so every payment on the site
    /// fails — which is worth refusing to start over.</summary>
    [Fact]
    public void EnsureCredentialsMatchEnvironment_Throws_WhenAProductionEnvironmentHasASandboxKey()
    {
        Should.Throw<InvalidOperationException>(
            () => CashfreeService.EnsureCredentialsMatchEnvironment(
                Credentials("production", "TEST11190806f0443e55c5602153d89a608091")));
    }

    /// <summary>The likelier half-done go-live, because nothing defaults the environment: the
    /// live keys get pasted into Render and Cashfree__Environment is forgotten, which quietly
    /// sends them to the sandbox gateway.</summary>
    [Theory]
    [InlineData("sandbox")]
    [InlineData("")]
    [InlineData(null)]
    public void EnsureCredentialsMatchEnvironment_Throws_WhenALiveKeyIsNotInProduction(string? environment)
    {
        Should.Throw<InvalidOperationException>(
            () => CashfreeService.EnsureCredentialsMatchEnvironment(
                Credentials(environment, "1234567890abcdef")));
    }

    [Theory]
    [InlineData("production", "1234567890abcdef")]
    [InlineData("sandbox", "TEST11190806f0443e55c5602153d89a608091")]
    public void EnsureCredentialsMatchEnvironment_Allows_AMatchingPair(string environment, string clientId)
    {
        Should.NotThrow(() => CashfreeService.EnsureCredentialsMatchEnvironment(
            Credentials(environment, clientId)));
    }

    /// <summary>An unconfigured gateway must not stop the storefront from starting — browsing
    /// still works, and the checkout says plainly that payments are unavailable.</summary>
    [Theory]
    [InlineData("sandbox", null)]
    [InlineData("production", null)]
    [InlineData("production", "")]
    public void EnsureCredentialsMatchEnvironment_DoesNotThrow_WhenThereAreNoCredentials(string environment, string? clientId)
    {
        Should.NotThrow(() => CashfreeService.EnsureCredentialsMatchEnvironment(Credentials(environment, clientId)));
    }

    // ---------- IsConfigured ----------

    [Fact]
    public void IsConfigured_IsFalse_WhenClientIdOrSecretMissing()
    {
        var service = new CashfreeService(new HttpClient(), UnconfiguredSettings());

        service.IsConfigured.ShouldBeFalse();
    }

    [Fact]
    public void IsConfigured_IsTrue_WhenBothClientIdAndSecretSet()
    {
        var service = new CashfreeService(new HttpClient(), ConfiguredSettings());

        service.IsConfigured.ShouldBeTrue();
    }

    // ---------- CreateOrderAsync ----------

    [Fact]
    public async Task CreateOrderAsync_ReturnsSessionDetails_OnSuccess()
    {
        var service = MakeService(_ => new HttpResponseMessage(HttpStatusCode.OK)
        {
            Content = new StringContent(
                """{"cf_order_id":"cf_order_1","payment_session_id":"session_abc"}""",
                Encoding.UTF8, "application/json"),
        });

        var result = await service.CreateOrderAsync(MakeOrder());

        result.CfOrderId.ShouldBe("cf_order_1");
        result.PaymentSessionId.ShouldBe("session_abc");
    }

    [Fact]
    public async Task CreateOrderAsync_SendsExpectedAuthHeadersAndPath()
    {
        HttpRequestMessage? captured = null;
        var service = MakeService(req =>
        {
            captured = req;
            return new HttpResponseMessage(HttpStatusCode.OK)
            {
                Content = new StringContent(
                    """{"cf_order_id":"cf_order_1","payment_session_id":"session_abc"}""",
                    Encoding.UTF8, "application/json"),
            };
        });

        await service.CreateOrderAsync(MakeOrder());

        captured.ShouldNotBeNull();
        captured!.RequestUri!.AbsolutePath.ShouldBe("/pg/orders");
        captured.Headers.GetValues("x-client-id").ShouldContain("test-client-id");
        captured.Headers.GetValues("x-client-secret").ShouldContain(ClientSecret);
        captured.Headers.GetValues("x-api-version").ShouldContain("2023-08-01");
    }

    /// <summary>
    /// The payment window is what turns an abandoned gateway order into an authoritative EXPIRED
    /// instead of something we have to infer from an empty payments list — and inferring failure
    /// from absence is what cancelled orders customers had paid for.
    ///
    /// It is asserted at the wire rather than trusted because the blast radius is the whole
    /// storefront: Cashfree rejects a malformed order_expiry_time outright, so a bad format string
    /// does not break one payment, it breaks every payment. The date is parsed back rather than
    /// string-matched, which is what actually proves Cashfree can read it.
    /// </summary>
    /// <summary>
    /// The regression test for a bug that stopped every order being placed.
    ///
    /// In a .NET custom format string <c>:</c> means "the current culture's time separator", not a
    /// colon. Under en-IN — the locale this shop is actually developed and run in — that is a full
    /// stop, so the expiry went out as <c>2026-09-04T18.00.33+00:00</c>, Cashfree rejected it with
    /// <c>order_expiry_time_invalid</c>, and checkout failed for everyone.
    ///
    /// The cultures below are the point of the test. The earlier version of it asserted the same
    /// property but ran under whatever culture the test host happened to use, so it passed against
    /// code that was broken on a real machine. A format claiming to be culture-independent has to
    /// be tested under a culture that would expose it.
    /// </summary>
    [Theory]
    [InlineData("en-IN")]   // time separator '.', and the one that actually bit us
    [InlineData("fi-FI")]   // time separator '.'
    [InlineData("en-US")]
    [InlineData("ar-SA")]   // non-Gregorian calendar
    public void FormatExpiry_IsIso8601_WhateverTheMachinesLocale(string culture)
    {
        var original = CultureInfo.CurrentCulture;
        try
        {
            CultureInfo.CurrentCulture = new CultureInfo(culture);
            var moment = new DateTimeOffset(2026, 9, 4, 18, 0, 33, TimeSpan.Zero);

            CashfreeService.FormatExpiry(moment).ShouldBe("2026-09-04T18:00:33Z");

            // Any offset, normalised to UTC — so the string never depends on the server's zone
            // either, and never contains a '+' for a JSON encoder to escape into something
            // Cashfree rejects.
            var ist = new DateTimeOffset(2026, 9, 4, 23, 30, 33, TimeSpan.FromHours(5.5));
            CashfreeService.FormatExpiry(ist).ShouldBe("2026-09-04T18:00:33Z");
        }
        finally
        {
            CultureInfo.CurrentCulture = original;
        }
    }

    [Fact]
    public async Task CreateOrderAsync_AsksForAPaymentWindowCashfreeCanParse()
    {
        string? body = null;
        var service = MakeService(req =>
        {
            body = req.Content!.ReadAsStringAsync().Result;
            return new HttpResponseMessage(HttpStatusCode.OK)
            {
                Content = new StringContent(
                    """{"cf_order_id":"cf_order_1","payment_session_id":"session_abc"}""",
                    Encoding.UTF8, "application/json"),
            };
        });

        await service.CreateOrderAsync(MakeOrder());

        using var payload = System.Text.Json.JsonDocument.Parse(body!);
        var expiry = payload.RootElement.GetProperty("order_expiry_time").GetString();

        DateTimeOffset.TryParse(
            expiry, CultureInfo.InvariantCulture, DateTimeStyles.RoundtripKind, out var parsed)
            .ShouldBeTrue($"Cashfree could not have parsed '{expiry}'.");

        // Cashfree requires at least fifteen minutes; ours is thirty, matching how long an unpaid
        // edit is held so a top-up and the changes it pays for die together.
        var window = parsed - DateTimeOffset.UtcNow;
        window.ShouldBeGreaterThan(TimeSpan.FromMinutes(15));
        window.ShouldBeLessThanOrEqualTo(CashfreeService.PaymentWindow);
    }

    [Fact]
    public async Task CreateOrderAsync_Throws_WhenCashfreeReturnsError()
    {
        var service = MakeService(_ => new HttpResponseMessage(HttpStatusCode.BadRequest)
        {
            Content = new StringContent("""{"message":"invalid order"}""", Encoding.UTF8, "application/json"),
        });

        await Should.ThrowAsync<InvalidOperationException>(() => service.CreateOrderAsync(MakeOrder()));
    }

    [Fact]
    public async Task CreateOrderAsync_Throws_WhenNotConfigured()
    {
        var service = new CashfreeService(new HttpClient(), UnconfiguredSettings());

        await Should.ThrowAsync<InvalidOperationException>(() => service.CreateOrderAsync(MakeOrder()));
    }

    // ---------- CreateRefundAsync ----------

    [Fact]
    public async Task CreateRefundAsync_ReturnsStatus_OnSuccess()
    {
        var service = MakeService(_ => new HttpResponseMessage(HttpStatusCode.OK)
        {
            Content = new StringContent("""{"refund_status":"SUCCESS"}""", Encoding.UTF8, "application/json"),
        });

        var result = await service.CreateRefundAsync("order-1", 100m, "refund-1", null);

        result.Success.ShouldBeTrue();
        result.RefundStatus.ShouldBe("SUCCESS");
    }

    [Fact]
    public async Task CreateRefundAsync_ReturnsFailure_OnErrorResponse()
    {
        var service = MakeService(_ => new HttpResponseMessage(HttpStatusCode.BadRequest)
        {
            Content = new StringContent("""{"message":"already refunded"}""", Encoding.UTF8, "application/json"),
        });

        var result = await service.CreateRefundAsync("order-1", 100m, "refund-1", null);

        result.Success.ShouldBeFalse();
        result.Error.ShouldNotBeNull();
    }

    [Fact]
    public async Task CreateRefundAsync_ReturnsFailure_WhenNotConfigured()
    {
        var service = new CashfreeService(new HttpClient(), UnconfiguredSettings());

        var result = await service.CreateRefundAsync("order-1", 100m, "refund-1", null);

        result.Success.ShouldBeFalse();
        result.Error.ShouldNotBeNull();
    }

    // ---------- VerifyWebhookSignature ----------

    [Fact]
    public void VerifyWebhookSignature_ReturnsTrue_ForCorrectlySignedPayload()
    {
        var service = new CashfreeService(new HttpClient(), ConfiguredSettings());
        const string body = """{"type":"PAYMENT_SUCCESS_WEBHOOK"}""";
        const string timestamp = "1700000000";
        var signature = ComputeSignature(body, timestamp, ClientSecret);

        service.VerifyWebhookSignature(body, timestamp, signature).ShouldBeTrue();
    }

    [Fact]
    public void VerifyWebhookSignature_ReturnsFalse_WhenBodyTampered()
    {
        var service = new CashfreeService(new HttpClient(), ConfiguredSettings());
        const string timestamp = "1700000000";
        var signature = ComputeSignature("""{"type":"PAYMENT_SUCCESS_WEBHOOK"}""", timestamp, ClientSecret);

        service.VerifyWebhookSignature("""{"type":"PAYMENT_FAILED_WEBHOOK"}""", timestamp, signature).ShouldBeFalse();
    }

    [Fact]
    public void VerifyWebhookSignature_ReturnsFalse_WhenSignedWithWrongSecret()
    {
        var service = new CashfreeService(new HttpClient(), ConfiguredSettings());
        const string body = """{"type":"PAYMENT_SUCCESS_WEBHOOK"}""";
        const string timestamp = "1700000000";
        var signature = ComputeSignature(body, timestamp, "a-different-secret");

        service.VerifyWebhookSignature(body, timestamp, signature).ShouldBeFalse();
    }

    [Fact]
    public void VerifyWebhookSignature_ReturnsFalse_WhenNotConfigured()
    {
        var service = new CashfreeService(new HttpClient(), UnconfiguredSettings());
        const string body = """{"type":"PAYMENT_SUCCESS_WEBHOOK"}""";
        const string timestamp = "1700000000";
        var signature = ComputeSignature(body, timestamp, ClientSecret);

        service.VerifyWebhookSignature(body, timestamp, signature).ShouldBeFalse();
    }
}
