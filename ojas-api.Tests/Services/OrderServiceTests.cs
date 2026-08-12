using Moq;
using MongoDB.Driver;
using OjasApi.Models;
using OjasApi.Services;
using OjasApi.Tests.TestHelpers;
using Shouldly;

namespace OjasApi.Tests.Services;

public class OrderServiceTests
{
    private readonly Mock<IMongoDbService> _dbMock = new();
    private readonly Mock<IMongoCollection<Order>> _ordersMock = new();
    private readonly OrderService _sut;

    public OrderServiceTests()
    {
        _dbMock.Setup(d => d.Orders).Returns(_ordersMock.Object);
        _sut = new OrderService(_dbMock.Object);
    }

    private static Order MakeOrder(string id = "507f1f77bcf86cd799439011", string userId = "user-1", string status = "Pending") => new()
    {
        Id = id,
        UserId = userId,
        FullName = "Jane Doe",
        Phone = "9123456789",
        Address = "123 Main St",
        Latitude = 18.5,
        Longitude = 73.8,
        Status = status,
    };

    [Fact]
    public async Task CreateOrderAsync_InsertsAndReturnsTheOrder()
    {
        var order = MakeOrder();

        var result = await _sut.CreateOrderAsync(order);

        _ordersMock.Verify(c => c.InsertOneAsync(order, null, It.IsAny<CancellationToken>()), Times.Once);
        result.ShouldBe(order);
    }

    [Fact]
    public async Task GetOrdersByUserAsync_ReturnsOrdersFromCollection()
    {
        var orders = new List<Order> { MakeOrder(), MakeOrder(id: "507f1f77bcf86cd799439012") };
        _ordersMock.SetupFind(orders);

        var result = await _sut.GetOrdersByUserAsync("user-1");

        result.Count.ShouldBe(2);
    }

    [Fact]
    public async Task GetAllOrdersAsync_ReturnsAllOrders()
    {
        var orders = new List<Order> { MakeOrder(), MakeOrder(id: "507f1f77bcf86cd799439012") };
        _ordersMock.SetupFind(orders);

        var result = await _sut.GetAllOrdersAsync();

        result.Count.ShouldBe(2);
    }

    [Fact]
    public async Task GetOrdersAssignedToDeliveryAsync_ReturnsOrdersFromCollection()
    {
        var orders = new List<Order> { MakeOrder() };
        _ordersMock.SetupFind(orders);

        var result = await _sut.GetOrdersAssignedToDeliveryAsync("delivery-1");

        result.Count.ShouldBe(1);
    }

    [Fact]
    public async Task GetOrderByIdAsync_ReturnsNull_WhenNoOrderMatches()
    {
        _ordersMock.SetupFind(new List<Order>());

        var result = await _sut.GetOrderByIdAsync("507f1f77bcf86cd799439011");

        result.ShouldBeNull();
    }

    [Fact]
    public async Task GetOrderByIdAsync_ReturnsOrder_WhenFound()
    {
        var order = MakeOrder();
        _ordersMock.SetupFind(new List<Order> { order });

        var result = await _sut.GetOrderByIdAsync(order.Id!);

        result.ShouldBe(order);
    }

    [Fact]
    public async Task UpdateOrderStatusAsync_ReturnsFalse_WhenStatusIsInvalid()
    {
        var result = await _sut.UpdateOrderStatusAsync("507f1f77bcf86cd799439011", "NotAStatus");

        result.ShouldBeFalse();
        _ordersMock.Verify(
            c => c.UpdateOneAsync(It.IsAny<FilterDefinition<Order>>(), It.IsAny<UpdateDefinition<Order>>(), It.IsAny<UpdateOptions>(), It.IsAny<CancellationToken>()),
            Times.Never);
    }

    [Fact]
    public async Task UpdateOrderStatusAsync_ReturnsTrue_WhenMatched()
    {
        _ordersMock
            .Setup(c => c.UpdateOneAsync(It.IsAny<FilterDefinition<Order>>(), It.IsAny<UpdateDefinition<Order>>(), It.IsAny<UpdateOptions>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync(new UpdateResult.Acknowledged(1, 1, null));

        var result = await _sut.UpdateOrderStatusAsync("507f1f77bcf86cd799439011", "confirmed");

        result.ShouldBeTrue();
    }

    [Fact]
    public async Task UpdateOrderStatusAsync_ReturnsFalse_WhenNoOrderMatched()
    {
        _ordersMock
            .Setup(c => c.UpdateOneAsync(It.IsAny<FilterDefinition<Order>>(), It.IsAny<UpdateDefinition<Order>>(), It.IsAny<UpdateOptions>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync(new UpdateResult.Acknowledged(0, 0, null));

        var result = await _sut.UpdateOrderStatusAsync("507f1f77bcf86cd799439011", "Confirmed");

        result.ShouldBeFalse();
    }

    [Fact]
    public async Task AssignDeliveryPartnerAsync_ReturnsTrue_WhenMatched()
    {
        _ordersMock
            .Setup(c => c.UpdateOneAsync(It.IsAny<FilterDefinition<Order>>(), It.IsAny<UpdateDefinition<Order>>(), It.IsAny<UpdateOptions>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync(new UpdateResult.Acknowledged(1, 1, null));

        var result = await _sut.AssignDeliveryPartnerAsync("507f1f77bcf86cd799439011", "delivery-1", "Delivery Guy");

        result.ShouldBeTrue();
    }

    [Fact]
    public async Task AssignDeliveryPartnerAsync_ReturnsFalse_WhenNoOrderMatched()
    {
        _ordersMock
            .Setup(c => c.UpdateOneAsync(It.IsAny<FilterDefinition<Order>>(), It.IsAny<UpdateDefinition<Order>>(), It.IsAny<UpdateOptions>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync(new UpdateResult.Acknowledged(0, 0, null));

        var result = await _sut.AssignDeliveryPartnerAsync("507f1f77bcf86cd799439011", "delivery-1", "Delivery Guy");

        result.ShouldBeFalse();
    }

    [Theory]
    [InlineData("Pending", "Pending")]
    [InlineData("pending", "Pending")]
    [InlineData("PENDING", "Pending")]
    [InlineData("  confirmed  ", "Confirmed")]
    [InlineData("Delivered", "Delivered")]
    public void NormalizeStatus_IsCaseInsensitive_AndTrimsWhitespace(string input, string expected)
    {
        var result = OrderService.NormalizeStatus(input);

        result.ShouldBe(expected);
    }

    [Theory]
    [InlineData("")]
    [InlineData("   ")]
    [InlineData("NotAStatus")]
    [InlineData("Cancel")]
    public void NormalizeStatus_ReturnsNull_ForInvalidOrBlankValues(string input)
    {
        var result = OrderService.NormalizeStatus(input);

        result.ShouldBeNull();
    }
}
