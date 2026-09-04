using System.Security.Cryptography;
using System.Text;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.Logging.Abstractions;
using Moq;
using MongoDB.Driver;
using OjasApi.Controllers;
using OjasApi.Models;
using OjasApi.Services;
using OjasApi.Tests.TestHelpers;
using Shouldly;

namespace OjasApi.Tests.Controllers;

public class PaymentsControllerTests
{
    private const string ClientSecret = FakeCashfreeHandler.ClientSecret;
    private const string OrderId = "507f1f77bcf86cd799439011";

    private readonly Mock<IMongoDbService> _dbMock = new();
    private readonly Mock<IMongoCollection<Order>> _ordersMock = new();
    private readonly Mock<IMongoCollection<Product>> _productsMock = new();
    private readonly FakeCashfreeHandler _cashfree = new();
    private readonly PaymentsController _sut;

    public PaymentsControllerTests()
    {
        _dbMock.Setup(d => d.Orders).Returns(_ordersMock.Object);
        _dbMock.Setup(d => d.Products).Returns(_productsMock.Object);

        _ordersMock
            .Setup(c => c.UpdateOneAsync(
                It.IsAny<FilterDefinition<Order>>(), It.IsAny<UpdateDefinition<Order>>(),
                It.IsAny<UpdateOptions>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync(new UpdateResult.Acknowledged(1, 1, null));
        _productsMock
            .Setup(c => c.UpdateOneAsync(
                It.IsAny<FilterDefinition<Product>>(), It.IsAny<UpdateDefinition<Product>>(),
                It.IsAny<UpdateOptions>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync(new UpdateResult.Acknowledged(1, 1, null));

        var orderService = new OrderService(_dbMock.Object);
        var productService = new ProductService(_dbMock.Object);

        var paymentOutcome = new OrderPaymentOutcomeService(
            orderService,
            productService,
            new WalletService(_dbMock.Object),
            _cashfree.Service(),
            NullLogger<OrderPaymentOutcomeService>.Instance);

        _sut = new PaymentsController(
            _cashfree.Service(), orderService, paymentOutcome,
            NullLogger<PaymentsController>.Instance);
    }

    private static Order MakeOrder(string status = "Pending") => new()
    {
        Id = OrderId,
        UserId = "user-1",
        FullName = "Jane Doe",
        Phone = "9123456789",
        Address = "123 Main St",
        Status = status,
        Items = [new OrderItem { ProductId = "507f1f77bcf86cd799439055", ProductName = "Bajra Flour", Price = 100, Weight = "500g", Quantity = 2 }],
    };

    private static string ComputeSignature(string body, string timestamp, string secret)
    {
        using var hmac = new HMACSHA256(Encoding.UTF8.GetBytes(secret));
        var hash = hmac.ComputeHash(Encoding.UTF8.GetBytes(timestamp + body));
        return Convert.ToBase64String(hash);
    }

    // ---------- Cashfree config ----------

    /// <summary>The browser has to load its checkout SDK in the same environment the payment
    /// session was raised in, and it gets that answer from here rather than from a constant baked
    /// into the bundle at build time.</summary>
    [Fact]
    public void GetCashfreeConfig_ReportsTheModeTheServerIsActuallyIn()
    {
        _sut.ControllerContext = new ControllerContext { HttpContext = new DefaultHttpContext() };

        var result = _sut.GetCashfreeConfig().ShouldBeOfType<OkObjectResult>();
        var config = result.Value.ShouldBeOfType<CashfreeConfigResponse>();

        config.Mode.ShouldBe("sandbox");
        config.Configured.ShouldBeTrue();
    }

    private void SetRequestBody(string rawBody, string? signatureOverride = null, string timestamp = "1700000000")
    {
        var context = new DefaultHttpContext();
        context.Request.Body = new MemoryStream(Encoding.UTF8.GetBytes(rawBody));
        context.Request.Headers["x-webhook-timestamp"] = timestamp;
        context.Request.Headers["x-webhook-signature"] = signatureOverride ?? ComputeSignature(rawBody, timestamp, ClientSecret);
        _sut.ControllerContext = new ControllerContext { HttpContext = context };
    }

    private static string SuccessPayload(
        string orderId = OrderId, string cfPaymentId = "cf_pay_1",
        string paymentGroup = "upi", decimal paymentAmount = 100m) =>
        "{\"type\":\"PAYMENT_SUCCESS_WEBHOOK\",\"event_time\":\"2026-08-22T00:00:00Z\",\"data\":{\"order\":{\"order_id\":\"" + orderId +
        "\"},\"payment\":{\"cf_payment_id\":\"" + cfPaymentId + "\",\"payment_status\":\"SUCCESS\",\"payment_group\":\"" +
        paymentGroup + "\",\"payment_amount\":" + paymentAmount + "}}}";

    /// <summary>Cashfree's human-readable explanation, which has to reach the customer intact.</summary>
    private const string FailedPayloadReason = "Your card was declined by the issuing bank";

    /// <summary>
    /// Puts the gateway order Cashfree is telling us about into the double, in the state a real
    /// failure webhook implies: it exists, and its only attempt failed.
    ///
    /// Standing an order down now requires Cashfree to confirm that no money is coming, precisely
    /// because a failed <em>attempt</em> is not a failed <em>order</em> — a customer whose first
    /// try times out and who then pays on the same page produces both webhooks, and delivery order
    /// is not guaranteed. Without this the double answers 404, which is correctly read as "we could
    /// not ask" rather than "it was never paid", and nothing is cancelled.
    /// </summary>
    private void GivenTheGatewayAgreesNothingWasPaid(string? gatewayOrderId = null) =>
        _cashfree.Seed(gatewayOrderId ?? OrderId, 200m, paymentStatus: "FAILED");

    private static string FailedPayload(string type, string orderId = OrderId) =>
        "{\"type\":\"" + type + "\",\"event_time\":\"2026-08-22T00:00:00Z\",\"data\":{\"order\":{\"order_id\":\"" + orderId +
        "\"},\"payment\":{\"payment_status\":\"FAILED\"},\"error_details\":{\"error_description\":\"" +
        FailedPayloadReason + "\"}}}";

    [Fact]
    public async Task CashfreeWebhook_ReturnsUnauthorized_WhenSignatureInvalid()
    {
        SetRequestBody(SuccessPayload(), signatureOverride: "not-the-real-signature");

        var result = await _sut.CashfreeWebhook();

        result.ShouldBeOfType<UnauthorizedResult>();
        _ordersMock.Verify(c => c.UpdateOneAsync(
            It.IsAny<FilterDefinition<Order>>(), It.IsAny<UpdateDefinition<Order>>(),
            It.IsAny<UpdateOptions>(), It.IsAny<CancellationToken>()), Times.Never);
    }

    [Fact]
    public async Task CashfreeWebhook_MarksOrderPaid_OnPaymentSuccessWebhook()
    {
        _ordersMock.SetupFind(new List<Order> { MakeOrder() });
        SetRequestBody(SuccessPayload());

        var result = await _sut.CashfreeWebhook();

        result.ShouldBeOfType<OkResult>();
        // Two writes: recording the payment, then re-deriving the paid figure and status from it.
        _ordersMock.Verify(c => c.UpdateOneAsync(
            It.IsAny<FilterDefinition<Order>>(), It.IsAny<UpdateDefinition<Order>>(),
            It.IsAny<UpdateOptions>(), It.IsAny<CancellationToken>()), Times.Exactly(2));
        // A payment confirmation never restores stock.
        _productsMock.Verify(c => c.UpdateOneAsync(
            It.IsAny<FilterDefinition<Product>>(), It.IsAny<UpdateDefinition<Product>>(),
            It.IsAny<UpdateOptions>(), It.IsAny<CancellationToken>()), Times.Never);
    }

    [Fact]
    public async Task CashfreeWebhook_LeavesTheOriginalOrderIntact_WhenATopUpFails()
    {
        // A top-up carries a suffixed Cashfree order id. Its failure means only the *extra* items
        // went unpaid - cancelling the whole (already paid) order would be badly wrong.
        _ordersMock.SetupFind(new List<Order> { MakeOrder() });
        SetRequestBody(FailedPayload("PAYMENT_FAILED_WEBHOOK", orderId: OrderId + "_20260822120000000"));

        var result = await _sut.CashfreeWebhook();

        result.ShouldBeOfType<OkResult>();
        _ordersMock.Verify(c => c.UpdateOneAsync(
            It.IsAny<FilterDefinition<Order>>(), It.IsAny<UpdateDefinition<Order>>(),
            It.IsAny<UpdateOptions>(), It.IsAny<CancellationToken>()), Times.Never);
        _productsMock.Verify(c => c.UpdateOneAsync(
            It.IsAny<FilterDefinition<Product>>(), It.IsAny<UpdateDefinition<Product>>(),
            It.IsAny<UpdateOptions>(), It.IsAny<CancellationToken>()), Times.Never);
    }

    [Fact]
    public async Task CashfreeWebhook_CreditsATopUpAgainstTheParentOrder()
    {
        var order = MakeOrder();
        order.TotalAmount = 300m;
        order.AmountPaid = 200m;
        _ordersMock.SetupFind(new List<Order> { order });
        SetRequestBody(SuccessPayload(orderId: OrderId + "_20260822120000000"));

        var result = await _sut.CashfreeWebhook();

        result.ShouldBeOfType<OkResult>();
        // Resolved back to the parent order and recorded there, not treated as a separate order:
        // one write to record the payment, one to re-derive the order's paid figure.
        _ordersMock.Verify(c => c.UpdateOneAsync(
            It.IsAny<FilterDefinition<Order>>(), It.IsAny<UpdateDefinition<Order>>(),
            It.IsAny<UpdateOptions>(), It.IsAny<CancellationToken>()), Times.Exactly(2));
    }

    [Theory]
    [InlineData("PAYMENT_FAILED_WEBHOOK")]
    [InlineData("PAYMENT_USER_DROPPED_WEBHOOK")]
    public async Task CashfreeWebhook_CancelsOrderAndRestoresStock_OnFailedOrDroppedWebhook(string type)
    {
        _ordersMock.SetupFind(new List<Order> { MakeOrder() });
        GivenTheGatewayAgreesNothingWasPaid();
        SetRequestBody(FailedPayload(type));

        var result = await _sut.CashfreeWebhook();

        result.ShouldBeOfType<OkResult>();
        // Cancelling the order, recording the failure and its reason, then re-deriving what the
        // order holds now that nothing was paid - three separate order updates.
        _ordersMock.Verify(c => c.UpdateOneAsync(
            It.IsAny<FilterDefinition<Order>>(), It.IsAny<UpdateDefinition<Order>>(),
            It.IsAny<UpdateOptions>(), It.IsAny<CancellationToken>()), Times.Exactly(3));
        _productsMock.Verify(c => c.UpdateOneAsync(
            It.IsAny<FilterDefinition<Product>>(), It.IsAny<UpdateDefinition<Product>>(),
            It.IsAny<UpdateOptions>(), It.IsAny<CancellationToken>()), Times.Once);
    }

    [Fact]
    public async Task CashfreeWebhook_RecordsWhyThePaymentFailed_SoTheCustomerIsToldTheRealReason()
    {
        _ordersMock.SetupFind(new List<Order> { MakeOrder() });
        GivenTheGatewayAgreesNothingWasPaid();
        SetRequestBody(FailedPayload("PAYMENT_FAILED_WEBHOOK"));

        var result = await _sut.CashfreeWebhook();

        result.ShouldBeOfType<OkResult>();
        // Cashfree's own wording, carried through rather than replaced with a guess about banks.
        _ordersMock.Verify(c => c.UpdateOneAsync(
            It.IsAny<FilterDefinition<Order>>(),
            It.Is<UpdateDefinition<Order>>(u => Renders(u).Contains(FailedPayloadReason)),
            It.IsAny<UpdateOptions>(), It.IsAny<CancellationToken>()), Times.Once);
    }

    /// <summary>The update as the driver would send it, so an assertion can look inside one.</summary>
    private static string Renders(UpdateDefinition<Order> update) =>
        update.Render(new RenderArgs<Order>(
            MongoDB.Bson.Serialization.BsonSerializer.SerializerRegistry.GetSerializer<Order>(),
            MongoDB.Bson.Serialization.BsonSerializer.SerializerRegistry)).ToString()!;

    // ---------- payload shapes we cannot rule out ----------
    //
    // The webhook endpoint is registered at version 2025-01-01 while our API calls are pinned to
    // 2023-08-01. That is legal - the two are configured independently - but Cashfree publishes no
    // field-level delta between those versions, so the exact shape arriving here is not knowable
    // from the documentation. These pin the property that matters: an unexpected shape is
    // acknowledged and logged, never thrown. A throw is a 500, Cashfree reads a 500 as a failed
    // delivery, and it retries forever.

    [Theory]
    // Not JSON at all - an error page from something in front of us.
    [InlineData("<html>502 Bad Gateway</html>")]
    // Valid JSON, but nothing we recognise.
    [InlineData("""{"hello":"world"}""")]
    // The event type is missing.
    [InlineData("""{"data":{"order":{"order_id":"507f1f77bcf86cd799439011"}}}""")]
    // A success event with no payment object under it.
    [InlineData("""{"type":"PAYMENT_SUCCESS_WEBHOOK","data":{"order":{"order_id":"507f1f77bcf86cd799439011"}}}""")]
    // A success event whose payment carries no id, so the money could not be recorded once.
    [InlineData("""{"type":"PAYMENT_SUCCESS_WEBHOOK","data":{"order":{"order_id":"507f1f77bcf86cd799439011"},"payment":{"payment_amount":100}}}""")]
    // A refund event with no refund object.
    [InlineData("""{"type":"REFUND_STATUS_WEBHOOK","data":{"order":{"order_id":"507f1f77bcf86cd799439011"}}}""")]
    // data is a string rather than an object.
    [InlineData("""{"type":"PAYMENT_SUCCESS_WEBHOOK","data":"nope"}""")]
    public async Task CashfreeWebhook_AcknowledgesAPayloadItCannotMakeSenseOf(string body)
    {
        _ordersMock.SetupFind(new List<Order> { MakeOrder() });
        SetRequestBody(body);

        // Never a 500: Cashfree treats that as undelivered and retries indefinitely, and the
        // retries arrive faster than they can be shed.
        (await _sut.CashfreeWebhook()).ShouldBeOfType<OkResult>();
    }

    /// <summary>Cashfree wrote these ids as integers before 2023-08-01 and as strings after it.
    /// Since the webhook version is configured separately from the one our API calls use, the id
    /// is read in a way that copes with either - it is the key the money is recorded under, so
    /// getting it wrong would either lose a payment or count it twice.</summary>
    [Theory]
    [InlineData("\"cf_pay_str_1\"")]
    [InlineData("987654321")]
    public async Task CashfreeWebhook_RecordsThePayment_WhicheverWayCashfreeTypesTheId(string cfPaymentId)
    {
        _ordersMock.SetupFind(new List<Order> { MakeOrder() });
        SetRequestBody(
            "{\"type\":\"PAYMENT_SUCCESS_WEBHOOK\",\"data\":{\"order\":{\"order_id\":\"" + OrderId +
            "\"},\"payment\":{\"cf_payment_id\":" + cfPaymentId +
            ",\"payment_status\":\"SUCCESS\",\"payment_group\":\"upi\",\"payment_amount\":200}}}");

        (await _sut.CashfreeWebhook()).ShouldBeOfType<OkResult>();

        // Recorded, then the order's paid figure re-derived.
        _ordersMock.Verify(c => c.UpdateOneAsync(
            It.IsAny<FilterDefinition<Order>>(), It.IsAny<UpdateDefinition<Order>>(),
            It.IsAny<UpdateOptions>(), It.IsAny<CancellationToken>()), Times.Exactly(2));
    }

    /// <summary>Cashfree documents error_details under data, but nests it under data.payment in
    /// the payments API. Both are read, because falling back to a generic "declined" on a payload
    /// that said exactly why is the sort of vague message the customer objected to.</summary>
    [Fact]
    public async Task CashfreeWebhook_FindsTheFailureReason_WhenItIsNestedUnderThePayment()
    {
        _ordersMock.SetupFind(new List<Order> { MakeOrder() });
        GivenTheGatewayAgreesNothingWasPaid();
        SetRequestBody(
            "{\"type\":\"PAYMENT_FAILED_WEBHOOK\",\"data\":{\"order\":{\"order_id\":\"" + OrderId +
            "\"},\"payment\":{\"payment_status\":\"FAILED\",\"error_details\":{\"error_description\":\"" +
            FailedPayloadReason + "\"}}}}");

        (await _sut.CashfreeWebhook()).ShouldBeOfType<OkResult>();

        _ordersMock.Verify(c => c.UpdateOneAsync(
            It.IsAny<FilterDefinition<Order>>(),
            It.Is<UpdateDefinition<Order>>(u => Renders(u).Contains(FailedPayloadReason)),
            It.IsAny<UpdateOptions>(), It.IsAny<CancellationToken>()), Times.Once);
    }

    [Fact]
    public async Task CashfreeWebhook_ReturnsOk_WhenFailedWebhookReferencesUnknownOrder()
    {
        _ordersMock.SetupFind(new List<Order>());
        SetRequestBody(FailedPayload("PAYMENT_FAILED_WEBHOOK", orderId: "507f1f77bcf86cd799439099"));

        var result = await _sut.CashfreeWebhook();

        // Acknowledge rather than error, so Cashfree doesn't keep retrying a webhook we can't act on.
        result.ShouldBeOfType<OkResult>();
    }
}
