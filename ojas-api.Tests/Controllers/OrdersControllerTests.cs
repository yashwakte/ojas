using System.Security.Claims;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
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
    private readonly OrdersController _sut;

    public OrdersControllerTests()
    {
        _dbMock.Setup(d => d.Orders).Returns(_ordersMock.Object);
        _dbMock.Setup(d => d.Users).Returns(_usersMock.Object);
        _dbMock.Setup(d => d.DeliveryCharges).Returns(_chargesMock.Object);

        _ordersMock
            .Setup(c => c.InsertOneAsync(It.IsAny<Order>(), null, It.IsAny<CancellationToken>()))
            .Callback<Order, InsertOneOptions?, CancellationToken>((order, _, _) => order.Id ??= "507f1f77bcf86cd799439099")
            .Returns(Task.CompletedTask);

        var orderService = new OrderService(_dbMock.Object);
        var deliveryChargesService = new DeliveryChargesService(_dbMock.Object);
        _sut = new OrdersController(orderService, _dbMock.Object, deliveryChargesService);

        SetUser("user-1");
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
        var items = new List<OrderItemDto> { new("p1", "Product", 10, "1kg", 1) };
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
            new("p1", "Product One", 100, "1kg", 2),
            new("p2", "Product Two", 50, "500g", 1),
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

        result.ShouldBeOfType<BadRequestObjectResult>();
    }

    [Fact]
    public async Task UpdateOrderStatusAsAdmin_ReturnsNotFound_WhenOrderMissing()
    {
        _ordersMock
            .Setup(c => c.UpdateOneAsync(It.IsAny<FilterDefinition<Order>>(), It.IsAny<UpdateDefinition<Order>>(), It.IsAny<UpdateOptions>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync(new UpdateResult.Acknowledged(0, 0, null));

        var result = await _sut.UpdateOrderStatusAsAdmin("507f1f77bcf86cd799439011", new UpdateOrderStatusRequest("Confirmed"));

        result.ShouldBeOfType<NotFoundObjectResult>();
    }

    [Fact]
    public async Task UpdateOrderStatusAsAdmin_ReturnsNoContent_OnSuccess()
    {
        _ordersMock
            .Setup(c => c.UpdateOneAsync(It.IsAny<FilterDefinition<Order>>(), It.IsAny<UpdateDefinition<Order>>(), It.IsAny<UpdateOptions>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync(new UpdateResult.Acknowledged(1, 1, null));

        var result = await _sut.UpdateOrderStatusAsAdmin("507f1f77bcf86cd799439011", new UpdateOrderStatusRequest("Confirmed"));

        result.ShouldBeOfType<NoContentResult>();
    }

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
