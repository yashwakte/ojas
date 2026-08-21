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
