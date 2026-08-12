using Microsoft.AspNetCore.Mvc;
using Moq;
using MongoDB.Driver;
using OjasApi.Controllers;
using OjasApi.Models;
using OjasApi.Services;
using OjasApi.Tests.TestHelpers;
using Shouldly;

namespace OjasApi.Tests.Controllers;

public class DeliveryChargesControllerTests
{
    private readonly Mock<IMongoDbService> _dbMock = new();
    private readonly Mock<IMongoCollection<DeliveryCharges>> _chargesMock = new();
    private readonly DeliveryChargesController _sut;

    public DeliveryChargesControllerTests()
    {
        _dbMock.Setup(d => d.DeliveryCharges).Returns(_chargesMock.Object);
        var service = new DeliveryChargesService(_dbMock.Object);
        _sut = new DeliveryChargesController(service);
    }

    private static DeliveryCharges MakeConfig() => new()
    {
        WarehouseAddress = "Warehouse",
        WarehouseLatitude = 18.0,
        WarehouseLongitude = 73.0,
        FreeDeliveryUpToKm = 5,
        PerKmChargeAfterFree = 10,
        IsActive = true,
    };

    [Fact]
    public async Task GetConfig_ReturnsNotFound_WhenNoConfigExists()
    {
        _chargesMock.SetupFind(new List<DeliveryCharges>());

        var result = await _sut.GetConfig();

        result.Result.ShouldBeOfType<NotFoundResult>();
    }

    [Fact]
    public async Task GetConfig_ReturnsOk_WhenConfigExists()
    {
        _chargesMock.SetupFind(new List<DeliveryCharges> { MakeConfig() });

        var result = await _sut.GetConfig();

        result.Result.ShouldBeOfType<OkObjectResult>();
    }

    [Fact]
    public async Task UpdateConfig_UpsertsAndReturnsOk()
    {
        _chargesMock.SetupFind(new List<DeliveryCharges>());
        var request = MakeConfig();

        var result = await _sut.UpdateConfig(request);

        var okResult = result.Result.ShouldBeOfType<OkObjectResult>();
        var config = okResult.Value.ShouldBeOfType<DeliveryCharges>();
        config.WarehouseAddress.ShouldBe("Warehouse");
        _chargesMock.Verify(c => c.InsertOneAsync(It.IsAny<DeliveryCharges>(), null, It.IsAny<CancellationToken>()), Times.Once);
    }

    [Fact]
    public async Task Calculate_ReturnsDistanceChargeAndFreeFlag()
    {
        _chargesMock.SetupFind(new List<DeliveryCharges> { MakeConfig() });

        var result = await _sut.Calculate(19.0, 73.0);

        var okResult = result.Result.ShouldBeOfType<OkObjectResult>();
        var response = okResult.Value.ShouldBeOfType<DeliveryChargeCalculationResponse>();
        response.IsFree.ShouldBeFalse();
        response.Charge.ShouldBe(1061.95m);
    }
}
