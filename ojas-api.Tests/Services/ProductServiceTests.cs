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
}
