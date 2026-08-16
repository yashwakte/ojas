using Moq;
using MongoDB.Driver;
using OjasApi.Models;
using OjasApi.Services;
using OjasApi.Tests.TestHelpers;
using Shouldly;

namespace OjasApi.Tests.Services;

public class DeliveryChargesServiceTests
{
    private readonly Mock<IMongoDbService> _dbMock = new();
    private readonly Mock<IMongoCollection<DeliveryCharges>> _chargesMock = new();
    private readonly DeliveryChargesService _sut;

    public DeliveryChargesServiceTests()
    {
        _dbMock.Setup(d => d.DeliveryCharges).Returns(_chargesMock.Object);
        _sut = new DeliveryChargesService(_dbMock.Object);
    }

    private static DeliveryCharges MakeConfig(
        double warehouseLat = 18.0,
        double warehouseLon = 73.0,
        double freeUpToKm = 5,
        decimal perKmAfterFree = 10,
        bool isActive = true,
        double maxRadiusKm = 0) => new()
    {
        Id = "507f1f77bcf86cd799439011",
        WarehouseAddress = "Test Warehouse",
        WarehouseLatitude = warehouseLat,
        WarehouseLongitude = warehouseLon,
        FreeDeliveryUpToKm = freeUpToKm,
        PerKmChargeAfterFree = perKmAfterFree,
        MaxDeliveryRadiusKm = maxRadiusKm,
        IsActive = isActive,
        CreatedAt = new DateTime(2025, 1, 1, 0, 0, 0, DateTimeKind.Utc),
    };

    [Fact]
    public async Task GetAsync_ReturnsNull_WhenNoConfigExists()
    {
        _chargesMock.SetupFind(new List<DeliveryCharges>());

        var result = await _sut.GetAsync();

        result.ShouldBeNull();
    }

    [Fact]
    public async Task GetAsync_ReturnsConfig_WhenOneExists()
    {
        var config = MakeConfig();
        _chargesMock.SetupFind(new List<DeliveryCharges> { config });

        var result = await _sut.GetAsync();

        result.ShouldBe(config);
    }

    [Fact]
    public async Task UpsertAsync_Inserts_WhenNoConfigExists()
    {
        _chargesMock.SetupFind(new List<DeliveryCharges>());
        var incoming = MakeConfig();
        incoming.Id = null;

        var result = await _sut.UpsertAsync(incoming);

        _chargesMock.Verify(c => c.InsertOneAsync(incoming, null, It.IsAny<CancellationToken>()), Times.Once);
        _chargesMock.Verify(
            c => c.ReplaceOneAsync(It.IsAny<FilterDefinition<DeliveryCharges>>(), It.IsAny<DeliveryCharges>(), It.IsAny<ReplaceOptions>(), It.IsAny<CancellationToken>()),
            Times.Never);
        result.ShouldBe(incoming);
    }

    [Fact]
    public async Task UpsertAsync_Replaces_AndPreservesOriginalIdAndCreatedAt_WhenConfigExists()
    {
        var existing = MakeConfig();
        _chargesMock.SetupFind(new List<DeliveryCharges> { existing });

        var incoming = MakeConfig(perKmAfterFree: 20);
        incoming.Id = null;
        incoming.CreatedAt = default;

        var result = await _sut.UpsertAsync(incoming);

        result.Id.ShouldBe(existing.Id);
        result.CreatedAt.ShouldBe(existing.CreatedAt);
        result.PerKmChargeAfterFree.ShouldBe(20);
        _chargesMock.Verify(
            c => c.ReplaceOneAsync(It.IsAny<FilterDefinition<DeliveryCharges>>(), incoming, It.IsAny<ReplaceOptions>(), It.IsAny<CancellationToken>()),
            Times.Once);
        _chargesMock.Verify(c => c.InsertOneAsync(It.IsAny<DeliveryCharges>(), null, It.IsAny<CancellationToken>()), Times.Never);
    }

    [Fact]
    public async Task CalculateDeliveryChargeAsync_ReturnsFree_WhenNoConfigExists()
    {
        _chargesMock.SetupFind(new List<DeliveryCharges>());

        var (distanceKm, charge, isFree, _, _) = await _sut.CalculateDeliveryChargeAsync(18.0, 73.0);

        distanceKm.ShouldBe(0);
        charge.ShouldBe(0);
        isFree.ShouldBeTrue();
    }

    [Fact]
    public async Task CalculateDeliveryChargeAsync_ReturnsFree_WhenConfigIsInactive()
    {
        var config = MakeConfig(isActive: false);
        _chargesMock.SetupFind(new List<DeliveryCharges> { config });

        var (distanceKm, charge, isFree, _, _) = await _sut.CalculateDeliveryChargeAsync(19.0, 73.0);

        distanceKm.ShouldBe(0);
        charge.ShouldBe(0);
        isFree.ShouldBeTrue();
    }

    [Fact]
    public async Task CalculateDeliveryChargeAsync_ReturnsFree_WhenWithinFreeRadius()
    {
        // Warehouse at (18.0, 73.0); delivery point 0.01 degree latitude away (~1.11 km), well within the 5km free radius.
        var config = MakeConfig(warehouseLat: 18.0, warehouseLon: 73.0, freeUpToKm: 5, perKmAfterFree: 10);
        _chargesMock.SetupFind(new List<DeliveryCharges> { config });

        var (distanceKm, charge, isFree, _, _) = await _sut.CalculateDeliveryChargeAsync(18.01, 73.0);

        distanceKm.ShouldBeLessThan(5);
        charge.ShouldBe(0);
        isFree.ShouldBeTrue();
    }

    [Fact]
    public async Task CalculateDeliveryChargeAsync_ChargesForDistanceBeyondFreeRadius()
    {
        // Pure north-south offset of exactly 1 degree latitude: haversine reduces to
        // R * radians(1deg) = 6371 * (pi/180) ~= 111.1949266 km, independent of longitude.
        var config = MakeConfig(warehouseLat: 18.0, warehouseLon: 73.0, freeUpToKm: 5, perKmAfterFree: 10);
        _chargesMock.SetupFind(new List<DeliveryCharges> { config });

        var (distanceKm, charge, isFree, _, _) = await _sut.CalculateDeliveryChargeAsync(19.0, 73.0);

        distanceKm.ShouldBe(111.1949, 0.001);
        // chargeableKm = 111.1949 - 5 = 106.1949; charge = round(106.1949 * 10, 2, AwayFromZero) = 1061.95
        charge.ShouldBe(1061.95m);
        isFree.ShouldBeFalse();
    }

    [Fact]
    public async Task CalculateDeliveryChargeAsync_IsServiceable_WhenNoRadiusConfigured()
    {
        // A zero radius means the restriction is switched off entirely.
        var config = MakeConfig(maxRadiusKm: 0);
        _chargesMock.SetupFind(new List<DeliveryCharges> { config });

        var quote = await _sut.CalculateDeliveryChargeAsync(19.0, 73.0);

        quote.IsServiceable.ShouldBeTrue();
        quote.Charge.ShouldBeGreaterThan(0);
    }

    [Fact]
    public async Task CalculateDeliveryChargeAsync_IsNotServiceable_BeyondMaxRadius()
    {
        // ~111.19 km away, well beyond the 25 km serviceable radius.
        var config = MakeConfig(maxRadiusKm: 25);
        _chargesMock.SetupFind(new List<DeliveryCharges> { config });

        var quote = await _sut.CalculateDeliveryChargeAsync(19.0, 73.0);

        quote.IsServiceable.ShouldBeFalse();
        quote.MaxRadiusKm.ShouldBe(25);
        // No charge is quoted for somewhere we refuse to deliver.
        quote.Charge.ShouldBe(0);
    }

    [Fact]
    public async Task CalculateDeliveryChargeAsync_IsServiceable_WithinMaxRadius()
    {
        // ~1.11 km away, inside both the free radius and the 25 km limit.
        var config = MakeConfig(maxRadiusKm: 25);
        _chargesMock.SetupFind(new List<DeliveryCharges> { config });

        var quote = await _sut.CalculateDeliveryChargeAsync(18.01, 73.0);

        quote.IsServiceable.ShouldBeTrue();
        quote.IsFree.ShouldBeTrue();
    }
}
