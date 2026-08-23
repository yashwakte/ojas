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
