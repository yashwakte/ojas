using System.Security.Claims;
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

public class OrdersControllerTests
{
    private readonly Mock<IMongoDbService> _dbMock = new();
    private readonly Mock<IMongoCollection<Order>> _ordersMock = new();
    private readonly Mock<IMongoCollection<User>> _usersMock = new();
    private readonly Mock<IMongoCollection<DeliveryCharges>> _chargesMock = new();
    private readonly Mock<IMongoCollection<Product>> _productsMock = new();
    private readonly FakeCashfreeHandler _cashfree = new();
    private readonly OrdersController _sut;

    public OrdersControllerTests()
    {
        _dbMock.Setup(d => d.Orders).Returns(_ordersMock.Object);
        _dbMock.Setup(d => d.Users).Returns(_usersMock.Object);
        _dbMock.Setup(d => d.DeliveryCharges).Returns(_chargesMock.Object);
        _dbMock.Setup(d => d.Products).Returns(_productsMock.Object);

        // Default: stock updates succeed, so existing order tests are unaffected
        // by the stock check that now runs before an order is created.
        _productsMock
            .Setup(c => c.UpdateOneAsync(
                It.IsAny<FilterDefinition<Product>>(),
                It.IsAny<UpdateDefinition<Product>>(),
                It.IsAny<UpdateOptions>(),
                It.IsAny<CancellationToken>()))
            .ReturnsAsync(new UpdateResult.Acknowledged(1, 1, null));

        // No wallet balance by default — placing an order now reads the customer's credit, and an
        // unmocked Users lookup returns a null cursor that NREs inside the driver.
        _usersMock.SetupFind(new List<User>());

        // Orders are priced from the catalog rather than from the request, so the catalog has to
        // hold the products these tests order — an id the catalog doesn't know is refused.
        _productsMock.SetupFind(new List<Product> { CatalogProductOne, CatalogProductTwo });

        // Order writes succeed by default. Without this the driver returns a null UpdateResult and
        // any post-insert write (recording the payment session, say) NREs inside a try/catch,
        // which then looks like a gateway failure rather than the fixture gap it is.
        _ordersMock
            .Setup(c => c.UpdateOneAsync(
                It.IsAny<FilterDefinition<Order>>(),
                It.IsAny<UpdateDefinition<Order>>(),
                It.IsAny<UpdateOptions>(),
                It.IsAny<CancellationToken>()))
            .ReturnsAsync(new UpdateResult.Acknowledged(1, 1, null));

        _ordersMock
            .Setup(c => c.InsertOneAsync(It.IsAny<Order>(), null, It.IsAny<CancellationToken>()))
            .Callback<Order, InsertOneOptions?, CancellationToken>((order, _, _) => order.Id ??= "507f1f77bcf86cd799439099")
            .Returns(Task.CompletedTask);

        _sut = BuildController(_cashfree.Service());

        SetUser("user-1");
    }

    private OrdersController BuildController(CashfreeService cashfreeService)
    {
        var paymentOutcome = new OrderPaymentOutcomeService(
            new OrderService(_dbMock.Object),
            new ProductService(_dbMock.Object),
            new WalletService(_dbMock.Object),
            cashfreeService,
            NullLogger<OrderPaymentOutcomeService>.Instance);

        return new(
            new OrderService(_dbMock.Object),
            _dbMock.Object,
            new DeliveryChargesService(_dbMock.Object),
            new ProductService(_dbMock.Object),
            cashfreeService,
            new WalletService(_dbMock.Object),
            paymentOutcome,
            new OrderCancellationService(
                new OrderService(_dbMock.Object),
                new ProductService(_dbMock.Object),
                new WalletService(_dbMock.Object),
                cashfreeService,
                paymentOutcome,
                NullLogger<OrderCancellationService>.Instance),
            NullLogger<OrdersController>.Instance);
    }

    /// <summary>A controller whose Cashfree has no credentials — the state production sits in
    /// before live keys are set, where online payment (and so all checkout) is unavailable.</summary>
    private OrdersController BuildUnconfiguredController()
    {
        var controller = BuildController(new CashfreeService(new HttpClient(), new ConfigurationBuilder().Build()));
        controller.ControllerContext = _sut.ControllerContext;
        return controller;
    }

    private void SetUser(string userId, string role = UserRoles.Customer)
    {
        var identity = new ClaimsIdentity(
            [new Claim(ClaimTypes.NameIdentifier, userId), new Claim(ClaimTypes.Role, role)],
            "TestAuth");
        _sut.ControllerContext = new ControllerContext
        {
            HttpContext = new DefaultHttpContext { User = new ClaimsPrincipal(identity) },
        };
    }

    private static Order MakeOrder(string id = "507f1f77bcf86cd799439011", string userId = "user-1", string? deliveryPartnerId = null, string status = "Pending") => new()
    {
        Id = id,
        UserId = userId,
        FullName = "Jane Doe",
        Phone = "9123456789",
        Address = "123 Main St",
        Latitude = 18.5,
        Longitude = 73.8,
        DeliveryPartnerId = deliveryPartnerId,
        Status = status,
    };

    private const string ProductOneId = "507f1f77bcf86cd799439055";
    private const string ProductTwoId = "507f1f77bcf86cd799439056";

    /// <summary>The catalog these tests price against. Prices here — not the ones in the
    /// request — are what an order is billed at.</summary>
    private static Product CatalogProductOne => new()
    {
        Id = ProductOneId,
        Name = "Product One",
        Description = "",
        Price = 100m,
        Category = "Flour",
        Weight = "1kg",
    };

    private static Product CatalogProductTwo => new()
    {
        Id = ProductTwoId,
        Name = "Product Two",
        Description = "",
        Price = 50m,
        Category = "Flour",
        Weight = "500g",
    };

    /// <summary>A real ObjectId, so stock filters serialize as they do in production.</summary>
    private static OrderItem MakeOrderItem(string productId = ProductOneId) => new()
    {
        ProductId = productId,
        ProductName = "Bajra Flour",
        Price = 100,
        Weight = "500g",
        Quantity = 2,
    };

    private static User MakeDeliveryUser(string id = "507f1f77bcf86cd799439022", string name = "Delivery Guy") => new()
    {
        Id = id,
        FullName = name,
        Email = "delivery@example.com",
        Phone = "9123456780",
        PasswordHash = "hash",
        Role = UserRoles.Delivery,
    };

    // ---------- PlaceOrder ----------

    [Fact]
    public async Task PlaceOrder_ReturnsBadRequest_WhenItemsIsEmpty()
    {
        var request = new PlaceOrderRequest("Jane", "9123456789", "Addr", 18.0, 73.0, "", []);

        var result = await _sut.PlaceOrder(request);

        result.Result.ShouldBeOfType<BadRequestObjectResult>();
    }

    [Fact]
    public async Task PlaceOrder_ReturnsBadRequest_WhenLatLngMissing()
    {
        var items = new List<OrderItemDto> { new(ProductOneId, "Product", 10, "1kg", 1) };
        var request = new PlaceOrderRequest("Jane", "9123456789", "Addr", null, null, "", items);

        var result = await _sut.PlaceOrder(request);

        result.Result.ShouldBeOfType<BadRequestObjectResult>();
    }

    [Fact]
    public async Task PlaceOrder_ComputesDeliveryChargeAndTotal_FromConfiguredWarehouse()
    {
        var config = new DeliveryCharges
        {
            WarehouseAddress = "Warehouse",
            WarehouseLatitude = 18.0,
            WarehouseLongitude = 73.0,
            FreeDeliveryUpToKm = 5,
            PerKmChargeAfterFree = 10,
            IsActive = true,
        };
        _chargesMock.SetupFind(new List<DeliveryCharges> { config });

        var items = new List<OrderItemDto>
        {
            new(ProductOneId, "Product One", 100, "1kg", 2),
            new(ProductTwoId, "Product Two", 50, "500g", 1),
        };
        // Delivery point exactly 1 degree latitude north of the warehouse => distance = 6371*(pi/180) ~= 111.1949km
        var request = new PlaceOrderRequest("Jane", "9123456789", "Addr", 19.0, 73.0, "Leave at door", items);

        var result = await _sut.PlaceOrder(request);

        var okResult = result.Result.ShouldBeOfType<OkObjectResult>();
        var order = okResult.Value.ShouldBeOfType<OrderResponse>();
        order.DeliveryCharge.ShouldBe(1061.95m);
        order.TotalAmount.ShouldBe(250m + 1061.95m);
        _ordersMock.Verify(c => c.InsertOneAsync(It.IsAny<Order>(), null, It.IsAny<CancellationToken>()), Times.Once);
    }

    [Fact]
    public async Task PlaceOrder_AlwaysCreatesAnOnlineOrder_SinceCodWasRetired()
    {
        _chargesMock.SetupFind(new List<DeliveryCharges>());
        var items = new List<OrderItemDto> { new(ProductOneId, "Product", 10, "1kg", 1) };

        var result = await _sut.PlaceOrder(new PlaceOrderRequest("Jane", "9123456789", "Addr", 18.0, 73.0, "", items));

        var okResult = result.Result.ShouldBeOfType<OkObjectResult>();
        var order = okResult.Value.ShouldBeOfType<OrderResponse>();
        order.PaymentMethod.ShouldBe("Cashfree");
        order.PaymentSessionId.ShouldNotBeNullOrWhiteSpace();
    }

    [Fact]
    public async Task PlaceOrder_ReturnsServiceUnavailable_WhenCashfreeNotConfigured()
    {
        // With COD gone there is no fallback, so an unconfigured gateway means no checkout at all.
        var items = new List<OrderItemDto> { new(ProductOneId, "Product", 10, "1kg", 1) };

        var result = await BuildUnconfiguredController()
            .PlaceOrder(new PlaceOrderRequest("Jane", "9123456789", "Addr", 18.0, 73.0, "", items));

        var statusResult = result.Result.ShouldBeOfType<ObjectResult>();
        statusResult.StatusCode.ShouldBe(StatusCodes.Status503ServiceUnavailable);
    }

    [Fact]
    public async Task PlaceOrder_RollsBackStockAndCancels_WhenCashfreeRefusesTheOrder()
    {
        _chargesMock.SetupFind(new List<DeliveryCharges>());
        _cashfree.FailOrderCreation = true;
        var items = new List<OrderItemDto> { new(ProductOneId, "Product", 10, "1kg", 1) };

        var result = await _sut.PlaceOrder(new PlaceOrderRequest("Jane", "9123456789", "Addr", 18.0, 73.0, "", items));

        var statusResult = result.Result.ShouldBeOfType<ObjectResult>();
        statusResult.StatusCode.ShouldBe(StatusCodes.Status502BadGateway);
        // Stock was taken before the gateway call, so it must be handed back: one consume, one restore.
        _productsMock.Verify(c => c.UpdateOneAsync(
            It.IsAny<FilterDefinition<Product>>(),
            It.IsAny<UpdateDefinition<Product>>(),
            It.IsAny<UpdateOptions>(),
            It.IsAny<CancellationToken>()), Times.Exactly(2));
    }

    // ---------- GetMyOrders / admin / delivery listings ----------

    [Fact]
    public async Task GetMyOrders_ReturnsOrdersForCurrentUser()
    {
        _ordersMock.SetupFind(new List<Order> { MakeOrder() });

        var result = await _sut.GetMyOrders();

        var okResult = result.Result.ShouldBeOfType<OkObjectResult>();
        var orders = okResult.Value.ShouldBeOfType<List<OrderResponse>>();
        orders.Count.ShouldBe(1);
    }

    [Fact]
    public async Task GetAllOrdersForAdmin_ReturnsAllOrders()
    {
        _ordersMock.SetupFind(new List<Order> { MakeOrder(), MakeOrder(id: "507f1f77bcf86cd799439012") });

        var result = await _sut.GetAllOrdersForAdmin();

        var okResult = result.Result.ShouldBeOfType<OkObjectResult>();
        var orders = okResult.Value.ShouldBeOfType<List<OrderResponse>>();
        orders.Count.ShouldBe(2);
    }

    [Fact]
    public async Task GetAssignedOrdersForDelivery_ReturnsAssignedOrders()
    {
        SetUser("delivery-1", UserRoles.Delivery);
        _ordersMock.SetupFind(new List<Order> { MakeOrder(deliveryPartnerId: "delivery-1") });

        var result = await _sut.GetAssignedOrdersForDelivery();

        var okResult = result.Result.ShouldBeOfType<OkObjectResult>();
        var orders = okResult.Value.ShouldBeOfType<List<OrderResponse>>();
        orders.Count.ShouldBe(1);
    }

    [Fact]
    public async Task GetDeliveryPartners_ReturnsStaffResponses()
    {
        _usersMock.SetupFind(new List<User> { MakeDeliveryUser() });

        var result = await _sut.GetDeliveryPartners();

        var okResult = result.Result.ShouldBeOfType<OkObjectResult>();
        var partners = okResult.Value.ShouldBeOfType<List<StaffUserResponse>>();
        partners.ShouldContain(p => p.FullName == "Delivery Guy");
    }

    // ---------- UpdateOrderStatusAsAdmin ----------

    [Fact]
    public async Task UpdateOrderStatusAsAdmin_ReturnsBadRequest_ForInvalidStatus()
    {
        var result = await _sut.UpdateOrderStatusAsAdmin("507f1f77bcf86cd799439011", new UpdateOrderStatusRequest("NotAStatus"));

        result.Result.ShouldBeOfType<BadRequestObjectResult>();
    }

    [Fact]
    public async Task UpdateOrderStatusAsAdmin_ReturnsNotFound_WhenOrderMissing()
    {
        // The controller now loads the order first, so it can restore stock on cancel.
        _ordersMock.SetupFind(new List<Order>());

        var result = await _sut.UpdateOrderStatusAsAdmin("507f1f77bcf86cd799439011", new UpdateOrderStatusRequest("Confirmed"));

        result.Result.ShouldBeOfType<NotFoundObjectResult>();
    }

    /// <summary>The whole order comes back rather than a bare 204: cancelling changes what the
    /// order holds and what was refunded, and a dashboard patching one field onto its own copy
    /// would go on showing the rest as it was before.</summary>
    [Fact]
    public async Task UpdateOrderStatusAsAdmin_ReturnsTheUpdatedOrder_OnSuccess()
    {
        _ordersMock.SetupFind(new List<Order> { MakeOrder() });
        _ordersMock
            .Setup(c => c.UpdateOneAsync(It.IsAny<FilterDefinition<Order>>(), It.IsAny<UpdateDefinition<Order>>(), It.IsAny<UpdateOptions>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync(new UpdateResult.Acknowledged(1, 1, null));

        var result = await _sut.UpdateOrderStatusAsAdmin("507f1f77bcf86cd799439011", new UpdateOrderStatusRequest("Confirmed"));

        var ok = result.Result.ShouldBeOfType<OkObjectResult>();
        var payload = ok.Value.ShouldBeOfType<AdminStatusChangeResponse>();
        payload.Order.ShouldNotBeNull();
        payload.RefundedToSource.ShouldBe(0m);
    }

    [Fact]
    public async Task UpdateOrderStatusAsAdmin_RestoresStock_WhenCancelling()
    {
        var order = MakeOrder();
        order.Items = [MakeOrderItem()];
        _ordersMock.SetupFind(new List<Order> { order });
        _ordersMock
            .Setup(c => c.UpdateOneAsync(It.IsAny<FilterDefinition<Order>>(), It.IsAny<UpdateDefinition<Order>>(), It.IsAny<UpdateOptions>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync(new UpdateResult.Acknowledged(1, 1, null));

        var result = await _sut.UpdateOrderStatusAsAdmin("507f1f77bcf86cd799439011", new UpdateOrderStatusRequest("Cancelled"));

        result.Result.ShouldBeOfType<OkObjectResult>();
        // Cancelled goods go back on the shelf — one update per order line.
        _productsMock.Verify(c => c.UpdateOneAsync(
            It.IsAny<FilterDefinition<Product>>(),
            It.IsAny<UpdateDefinition<Product>>(),
            It.IsAny<UpdateOptions>(),
            It.IsAny<CancellationToken>()), Times.Once);
    }

    // Cancelling twice used to be guarded by reading the status and writing it afterwards, which
    // a mocked collection could express. It is now claimed by the cancelling write's own filter,
    // which only a real database enforces — so that guarantee is covered by
    // AdminCancellationTests.CancellingTwice_RefundsOnlyOnce against real MongoDB. A mock that
    // acknowledges every update would assert the mock rather than the behaviour.

    // ---------- AssignDeliveryPartner ----------

    [Fact]
    public async Task AssignDeliveryPartner_ReturnsBadRequest_WhenPartnerIsInvalid()
    {
        _usersMock.SetupFind(new List<User>());

        var result = await _sut.AssignDeliveryPartner("507f1f77bcf86cd799439011", new AssignDeliveryPartnerRequest("not-a-real-id"));

        result.ShouldBeOfType<BadRequestObjectResult>();
    }

    [Fact]
    public async Task AssignDeliveryPartner_ReturnsNoContent_OnSuccess()
    {
        var partner = MakeDeliveryUser();
        _usersMock.SetupFind(new List<User> { partner });
        _ordersMock
            .Setup(c => c.UpdateOneAsync(It.IsAny<FilterDefinition<Order>>(), It.IsAny<UpdateDefinition<Order>>(), It.IsAny<UpdateOptions>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync(new UpdateResult.Acknowledged(1, 1, null));

        var result = await _sut.AssignDeliveryPartner("507f1f77bcf86cd799439011", new AssignDeliveryPartnerRequest(partner.Id!));

        result.ShouldBeOfType<NoContentResult>();
    }

    [Fact]
    public async Task AssignDeliveryPartner_ReturnsNotFound_WhenOrderMissing()
    {
        var partner = MakeDeliveryUser();
        _usersMock.SetupFind(new List<User> { partner });
        _ordersMock
            .Setup(c => c.UpdateOneAsync(It.IsAny<FilterDefinition<Order>>(), It.IsAny<UpdateDefinition<Order>>(), It.IsAny<UpdateOptions>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync(new UpdateResult.Acknowledged(0, 0, null));

        var result = await _sut.AssignDeliveryPartner("507f1f77bcf86cd799439011", new AssignDeliveryPartnerRequest(partner.Id!));

        result.ShouldBeOfType<NotFoundObjectResult>();
    }

    // ---------- RefundOrder ----------

    [Fact]
    public async Task RefundOrder_ReturnsNotFound_WhenOrderMissing()
    {
        _ordersMock.SetupFind(new List<Order>());

        var result = await _sut.RefundOrder("507f1f77bcf86cd799439011", new RefundOrderRequest(100m));

        result.ShouldBeOfType<NotFoundObjectResult>();
    }

    /// <summary>An order that actually captured money online, so a refund is possible.</summary>
    private Order MakePaidOrder(decimal totalAmount = 200m, decimal amountPaid = 200m)
    {
        var order = MakeOrder();
        order.PaymentMethod = "Cashfree";
        order.PaymentStatus = "Paid";
        order.TotalAmount = totalAmount;
        order.AmountPaid = amountPaid;
        _ordersMock.SetupFind(new List<Order> { order });
        return order;
    }

    [Fact]
    public async Task RefundOrder_ReturnsBadRequest_ForLegacyCodOrder()
    {
        var order = MakeOrder();
        order.PaymentMethod = "COD";
        order.PaymentStatus = "Collected";
        order.TotalAmount = 200m;
        _ordersMock.SetupFind(new List<Order> { order });

        var result = await _sut.RefundOrder(order.Id!, new RefundOrderRequest(100m));

        result.ShouldBeOfType<BadRequestObjectResult>();
    }

    [Fact]
    public async Task RefundOrder_ReturnsBadRequest_WhenNothingWasEverCaptured()
    {
        var order = MakePaidOrder(amountPaid: 0m);
        order.PaymentStatus = "Pending";

        var result = await _sut.RefundOrder(order.Id!, new RefundOrderRequest(100m));

        result.ShouldBeOfType<BadRequestObjectResult>();
    }

    // The cap on a refund now lives in the update's own filter, so two refunds issued at the same
    // moment cannot each see the full balance and each pay out. A mocked collection answers every
    // filter the same way and so cannot express that - RefundTests covers it against real
    // MongoDB instead, including the concurrent case that motivated the change.

    [Fact]
    public async Task RefundOrder_ReturnsBadRequest_WhenAmountIsZeroOrNegative()
    {
        var order = MakePaidOrder();

        var result = await _sut.RefundOrder(order.Id!, new RefundOrderRequest(0m));

        result.ShouldBeOfType<BadRequestObjectResult>();
    }

    [Fact]
    public async Task RefundOrder_SucceedsAndClearsThePendingRefundFlag()
    {
        var order = MakePaidOrder();
        order.RefundPendingAmount = 100m;
        _ordersMock
            .Setup(c => c.UpdateOneAsync(It.IsAny<FilterDefinition<Order>>(), It.IsAny<UpdateDefinition<Order>>(), It.IsAny<UpdateOptions>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync(new UpdateResult.Acknowledged(1, 1, null));

        var result = await _sut.RefundOrder(order.Id!, new RefundOrderRequest(100m));

        result.ShouldBeOfType<OkObjectResult>();
        // Four writes once the money is on its way back: the amount is reserved before the payout,
        // the refund is recorded against the gateway order that took the money, the queued
        // reminder is discharged, and the paid figure is re-derived from all of it.
        _ordersMock.Verify(c => c.UpdateOneAsync(
            It.IsAny<FilterDefinition<Order>>(), It.IsAny<UpdateDefinition<Order>>(),
            It.IsAny<UpdateOptions>(), It.IsAny<CancellationToken>()), Times.Exactly(4));
    }

    [Fact]
    public async Task RefundOrder_ReturnsBadGateway_WhenCashfreeNotConfigured()
    {
        var order = MakePaidOrder();

        var result = await BuildUnconfiguredController().RefundOrder(order.Id!, new RefundOrderRequest(100m));

        var statusResult = result.ShouldBeOfType<ObjectResult>();
        statusResult.StatusCode.ShouldBe(StatusCodes.Status502BadGateway);
    }

    // ---------- MarkDeliveredByDeliveryPartner ----------

    [Fact]
    public async Task MarkDeliveredByDeliveryPartner_ReturnsForbid_WhenWrongPartner()
    {
        SetUser("delivery-1", UserRoles.Delivery);
        var order = MakeOrder(deliveryPartnerId: "someone-else");
        _ordersMock.SetupFind(new List<Order> { order });

        var result = await _sut.MarkDeliveredByDeliveryPartner(order.Id!);

        result.ShouldBeOfType<ForbidResult>();
    }

    [Fact]
    public async Task MarkDeliveredByDeliveryPartner_ReturnsNoContent_WithoutUpdating_WhenAlreadyDelivered()
    {
        SetUser("delivery-1", UserRoles.Delivery);
        var order = MakeOrder(deliveryPartnerId: "delivery-1", status: "Delivered");
        _ordersMock.SetupFind(new List<Order> { order });

        var result = await _sut.MarkDeliveredByDeliveryPartner(order.Id!);

        result.ShouldBeOfType<NoContentResult>();
        _ordersMock.Verify(
            c => c.UpdateOneAsync(It.IsAny<FilterDefinition<Order>>(), It.IsAny<UpdateDefinition<Order>>(), It.IsAny<UpdateOptions>(), It.IsAny<CancellationToken>()),
            Times.Never);
    }

    [Fact]
    public async Task MarkDeliveredByDeliveryPartner_UpdatesStatus_OnHappyPath()
    {
        SetUser("delivery-1", UserRoles.Delivery);
        var order = MakeOrder(deliveryPartnerId: "delivery-1", status: "Shipped");
        _ordersMock.SetupFind(new List<Order> { order });
        _ordersMock
            .Setup(c => c.UpdateOneAsync(It.IsAny<FilterDefinition<Order>>(), It.IsAny<UpdateDefinition<Order>>(), It.IsAny<UpdateOptions>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync(new UpdateResult.Acknowledged(1, 1, null));

        var result = await _sut.MarkDeliveredByDeliveryPartner(order.Id!);

        result.ShouldBeOfType<NoContentResult>();
        _ordersMock.Verify(
            c => c.UpdateOneAsync(It.IsAny<FilterDefinition<Order>>(), It.IsAny<UpdateDefinition<Order>>(), It.IsAny<UpdateOptions>(), It.IsAny<CancellationToken>()),
            Times.Once);
    }

    [Fact]
    public async Task MarkDeliveredByDeliveryPartner_ReturnsNotFound_WhenOrderMissing()
    {
        SetUser("delivery-1", UserRoles.Delivery);
        _ordersMock.SetupFind(new List<Order>());

        var result = await _sut.MarkDeliveredByDeliveryPartner("507f1f77bcf86cd799439011");

        result.ShouldBeOfType<NotFoundObjectResult>();
    }
}
