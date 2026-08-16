using Moq;
using MongoDB.Driver;
using OjasApi.Models;
using OjasApi.Services;
using OjasApi.Tests.TestHelpers;
using Shouldly;

namespace OjasApi.Tests.Services;

public class ProductServiceTests
{
    private readonly Mock<IMongoDbService> _dbMock = new();
    private readonly Mock<IMongoCollection<Product>> _productsMock = new();
    private readonly ProductService _sut;

    public ProductServiceTests()
    {
        _dbMock.Setup(d => d.Products).Returns(_productsMock.Object);
        _sut = new ProductService(_dbMock.Object);
    }

    private static Product MakeProduct(string id, string name = "Bajra Flour") => new()
    {
        Id = id,
        Name = name,
        Description = "A test product description that is long enough.",
        Price = 100,
        Category = "Flour",
        ImageUrl = "/images/test.jpg",
        Weight = "500g",
        Ingredients = "Bajra",
        Benefits = "Fiber",
        StorageInfo = "Cool dry place",
    };

    [Fact]
    public async Task GetAllAsync_ReturnsAllProductsFromCollection()
    {
        var products = new List<Product> { MakeProduct("507f1f77bcf86cd799439011"), MakeProduct("507f1f77bcf86cd799439012", "Rice Flour") };
        _productsMock.SetupFind(products);

        var result = await _sut.GetAllAsync();

        result.Count.ShouldBe(2);
        result.ShouldContain(p => p.Name == "Rice Flour");
    }

    [Fact]
    public async Task GetByIdAsync_ReturnsNull_WhenNoProductMatches()
    {
        _productsMock.SetupFind(new List<Product>());

        var result = await _sut.GetByIdAsync("507f1f77bcf86cd799439011");

        result.ShouldBeNull();
    }

    [Fact]
    public async Task CreateAsync_InsertsProductAndReturnsIt()
    {
        var product = MakeProduct("507f1f77bcf86cd799439011");

        var result = await _sut.CreateAsync(product);

        _productsMock.Verify(c => c.InsertOneAsync(product, null, It.IsAny<CancellationToken>()), Times.Once);
        result.ShouldBe(product);
    }

    [Fact]
    public async Task UpdateAsync_ReturnsNull_WhenProductDoesNotExist()
    {
        _productsMock.SetupFind(new List<Product>());

        var result = await _sut.UpdateAsync("507f1f77bcf86cd799439011", new UpdateProductRequest { Name = "New Name" });

        result.ShouldBeNull();
        _productsMock.Verify(
            c => c.ReplaceOneAsync(It.IsAny<FilterDefinition<Product>>(), It.IsAny<Product>(), It.IsAny<ReplaceOptions>(), It.IsAny<CancellationToken>()),
            Times.Never);
    }

    [Fact]
    public async Task UpdateAsync_AppliesOnlyProvidedFields_AndBumpsUpdatedAt()
    {
        var existing = MakeProduct("507f1f77bcf86cd799439011");
        var originalUpdatedAt = existing.UpdatedAt;
        _productsMock.SetupFind(new List<Product> { existing });

        var result = await _sut.UpdateAsync(existing.Id!, new UpdateProductRequest { Price = 250 });

        result.ShouldNotBeNull();
        result!.Price.ShouldBe(250);
        result.Name.ShouldBe(existing.Name);
        result.UpdatedAt.ShouldBeGreaterThanOrEqualTo(originalUpdatedAt);
    }

    [Fact]
    public async Task DeleteAsync_ReturnsFalse_WhenNothingWasDeleted()
    {
        _productsMock
            .Setup(c => c.DeleteOneAsync(It.IsAny<FilterDefinition<Product>>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync(new DeleteResult.Acknowledged(0));

        var result = await _sut.DeleteAsync("507f1f77bcf86cd799439011");

        result.ShouldBeFalse();
    }

    [Fact]
    public async Task DeleteAsync_ReturnsTrue_WhenADocumentWasDeleted()
    {
        _productsMock
            .Setup(c => c.DeleteOneAsync(It.IsAny<FilterDefinition<Product>>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync(new DeleteResult.Acknowledged(1));

        var result = await _sut.DeleteAsync("507f1f77bcf86cd799439011");

        result.ShouldBeTrue();
    }

    [Fact]
    public async Task SeedAsync_InsertsProducts_WhenCollectionIsEmpty()
    {
        _productsMock
            .Setup(c => c.CountDocumentsAsync(It.IsAny<FilterDefinition<Product>>(), It.IsAny<CountOptions>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync(0);
        var products = new List<Product> { MakeProduct("507f1f77bcf86cd799439011") };

        await _sut.SeedAsync(products);

        _productsMock.Verify(c => c.InsertManyAsync(products, null, It.IsAny<CancellationToken>()), Times.Once);
    }

    [Fact]
    public async Task SeedAsync_DoesNothing_WhenCollectionAlreadyHasProducts()
    {
        _productsMock
            .Setup(c => c.CountDocumentsAsync(It.IsAny<FilterDefinition<Product>>(), It.IsAny<CountOptions>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync(5);
        var products = new List<Product> { MakeProduct("507f1f77bcf86cd799439011") };

        await _sut.SeedAsync(products);

        _productsMock.Verify(c => c.InsertManyAsync(It.IsAny<IEnumerable<Product>>(), It.IsAny<InsertManyOptions>(), It.IsAny<CancellationToken>()), Times.Never);
    }

    // ===== Stock =====

    private void SetupUpdateResults(params long[] matchedCounts)
    {
        var sequence = _productsMock.SetupSequence(c => c.UpdateOneAsync(
            It.IsAny<FilterDefinition<Product>>(),
            It.IsAny<UpdateDefinition<Product>>(),
            It.IsAny<UpdateOptions>(),
            It.IsAny<CancellationToken>()));

        foreach (var matched in matchedCounts)
        {
            sequence = sequence.ReturnsAsync(new UpdateResult.Acknowledged(matched, matched, null));
        }
    }

    [Fact]
    public async Task TryConsumeStockAsync_Succeeds_WhenStockIsSufficient()
    {
        SetupUpdateResults(1, 1);

        var result = await _sut.TryConsumeStockAsync(
        [
            ("507f1f77bcf86cd799439011", 2, "Bajra Flour"),
            ("507f1f77bcf86cd799439012", 1, "Rice Flour"),
        ]);

        result.Success.ShouldBeTrue();
        _productsMock.Verify(c => c.UpdateOneAsync(
            It.IsAny<FilterDefinition<Product>>(),
            It.IsAny<UpdateDefinition<Product>>(),
            It.IsAny<UpdateOptions>(),
            It.IsAny<CancellationToken>()), Times.Exactly(2));
    }

    [Fact]
    public async Task TryConsumeStockAsync_SkipsUntrackedProducts_WithoutFailing()
    {
        // The conditional update matches nothing because stockQuantity is null;
        // an untracked product is simply not counted down.
        var untracked = MakeProduct("507f1f77bcf86cd799439011");
        untracked.StockQuantity = null;
        _productsMock.SetupFind([untracked]);
        SetupUpdateResults(0);

        var result = await _sut.TryConsumeStockAsync([("507f1f77bcf86cd799439011", 3, "Bajra Flour")]);

        result.Success.ShouldBeTrue();
    }

    [Fact]
    public async Task TryConsumeStockAsync_Fails_AndReportsWhatIsLeft_WhenShort()
    {
        var short_ = MakeProduct("507f1f77bcf86cd799439011", "Bajra Flour");
        short_.StockQuantity = 2;
        _productsMock.SetupFind([short_]);
        SetupUpdateResults(0);

        var result = await _sut.TryConsumeStockAsync([("507f1f77bcf86cd799439011", 5, "Bajra Flour")]);

        result.Success.ShouldBeFalse();
        result.ProductName.ShouldBe("Bajra Flour");
        result.Available.ShouldBe(2);
    }

    [Fact]
    public async Task TryConsumeStockAsync_RollsBackEarlierLines_WhenALaterLineIsShort()
    {
        var short_ = MakeProduct("507f1f77bcf86cd799439012", "Rice Flour");
        short_.StockQuantity = 0;
        _productsMock.SetupFind([short_]);

        // take first line, second line short, then the restore of the first line
        SetupUpdateResults(1, 0, 1);

        var result = await _sut.TryConsumeStockAsync(
        [
            ("507f1f77bcf86cd799439011", 2, "Bajra Flour"),
            ("507f1f77bcf86cd799439012", 1, "Rice Flour"),
        ]);

        result.Success.ShouldBeFalse();
        // Three updates: the take, the failed attempt, and the compensating restore —
        // so a partial failure never leaves stock silently consumed.
        _productsMock.Verify(c => c.UpdateOneAsync(
            It.IsAny<FilterDefinition<Product>>(),
            It.IsAny<UpdateDefinition<Product>>(),
            It.IsAny<UpdateOptions>(),
            It.IsAny<CancellationToken>()), Times.Exactly(3));
    }

    [Fact]
    public async Task TryConsumeStockAsync_IgnoresNonPositiveQuantities()
    {
        var result = await _sut.TryConsumeStockAsync([("507f1f77bcf86cd799439011", 0, "Bajra Flour")]);

        result.Success.ShouldBeTrue();
        _productsMock.Verify(c => c.UpdateOneAsync(
            It.IsAny<FilterDefinition<Product>>(),
            It.IsAny<UpdateDefinition<Product>>(),
            It.IsAny<UpdateOptions>(),
            It.IsAny<CancellationToken>()), Times.Never);
    }

    [Fact]
    public async Task GetLowStockAsync_ReturnsTrackedProductsAtOrBelowThreshold_NeediestFirst()
    {
        var plenty = MakeProduct("507f1f77bcf86cd799439011", "Plenty");
        plenty.StockQuantity = 50;
        plenty.LowStockThreshold = 5;

        var low = MakeProduct("507f1f77bcf86cd799439012", "Low");
        low.StockQuantity = 3;
        low.LowStockThreshold = 5;

        var out_ = MakeProduct("507f1f77bcf86cd799439013", "Empty");
        out_.StockQuantity = 0;
        out_.LowStockThreshold = 5;

        _productsMock.SetupFind([plenty, low, out_]);

        var result = await _sut.GetLowStockAsync();

        result.Select(p => p.Name).ShouldBe(["Empty", "Low"]);
    }
}
