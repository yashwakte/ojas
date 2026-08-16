using Microsoft.AspNetCore.Mvc;
using Moq;
using MongoDB.Bson;
using MongoDB.Driver;
using OjasApi.Controllers;
using OjasApi.Models;
using OjasApi.Services;
using OjasApi.Tests.TestHelpers;
using Shouldly;

namespace OjasApi.Tests.Controllers;

public class ProductsControllerTests
{
    private readonly Mock<IMongoDbService> _dbMock = new();
    private readonly Mock<IMongoCollection<Product>> _productsMock = new();
    private readonly Mock<IMongoCollection<Order>> _ordersMock = new();
    private readonly Mock<IMongoCollection<CampaignBanner>> _bannersMock = new();
    private readonly ProductsController _sut;

    public ProductsControllerTests()
    {
        _dbMock.Setup(d => d.Products).Returns(_productsMock.Object);
        _dbMock.Setup(d => d.Orders).Returns(_ordersMock.Object);
        _dbMock.Setup(d => d.CampaignBanners).Returns(_bannersMock.Object);
        var productService = new ProductService(_dbMock.Object);
        _sut = new ProductsController(productService);
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
        Benefits = "Fiber content",
        StorageInfo = "Cool dry place",
    };

    private static CreateProductRequest MakeValidCreateRequest(
        string name = "Bajra Flour",
        decimal price = 100,
        decimal discount = 0,
        List<string>? galleryImageUrls = null) => new()
    {
        Name = name,
        Description = "A test product description that is long enough to pass.",
        Price = price,
        Discount = discount,
        Category = "Flour",
        ImageUrl = "/images/test.jpg",
        GalleryImageUrls = galleryImageUrls ?? [],
        Weight = "500g",
        IsAvailable = true,
        Ingredients = "Bajra grain",
        Benefits = "Good source of fiber",
        StorageInfo = "Store in a cool, dry place.",
    };

    // ---------- GetAll / GetById / GetByCategory ----------

    [Fact]
    public async Task GetAll_ReturnsOkWithProducts()
    {
        var products = new List<Product> { MakeProduct("507f1f77bcf86cd799439011") };
        _productsMock.SetupFind(products);

        var result = await _sut.GetAll();

        var okResult = result.Result.ShouldBeOfType<OkObjectResult>();
        okResult.Value.ShouldBe(products);
    }

    [Fact]
    public async Task GetById_ReturnsOk_WhenFound()
    {
        var product = MakeProduct("507f1f77bcf86cd799439011");
        _productsMock.SetupFind(new List<Product> { product });

        var result = await _sut.GetById(product.Id!);

        var okResult = result.Result.ShouldBeOfType<OkObjectResult>();
        okResult.Value.ShouldBe(product);
    }

    [Fact]
    public async Task GetById_ReturnsNotFound_WhenMissing()
    {
        _productsMock.SetupFind(new List<Product>());

        var result = await _sut.GetById("507f1f77bcf86cd799439011");

        result.Result.ShouldBeOfType<NotFoundResult>();
    }

    [Fact]
    public async Task GetByCategory_ReturnsOkWithProducts()
    {
        var products = new List<Product> { MakeProduct("507f1f77bcf86cd799439011") };
        _productsMock.SetupFind(products);

        var result = await _sut.GetByCategory("Flour");

        var okResult = result.Result.ShouldBeOfType<OkObjectResult>();
        okResult.Value.ShouldBe(products);
    }

    // ---------- GetBestsellers ----------
    // Aggregate pipelines are hard to mock meaningfully (generic pipeline/result types), and the mocked
    // Find() helper doesn't honor .Limit() either, so exact clamp-boundary verification (limit<1 => 1,
    // limit>24 => 24) is covered by an integration test against real Mongo2Go instead. This test just
    // confirms the controller wires through to the service and returns Ok without blowing up when the
    // ranked-orders aggregate comes back empty (falling through to the campaign-banner/backfill paths).
    [Fact]
    public async Task GetBestsellers_ReturnsOk_WhenNoSalesDataYet()
    {
        // Aggregate<TResult>() is a synchronous interface member returning IAsyncCursor<TResult> directly
        // (not Task<IAsyncCursor<TResult>> like AggregateAsync) - ToListAsync() is then called on that
        // cursor directly, so it's this sync overload that needs mocking, not AggregateAsync.
        _ordersMock
            .Setup(c => c.Aggregate(
                It.IsAny<PipelineDefinition<Order, BsonDocument>>(),
                It.IsAny<AggregateOptions>(),
                It.IsAny<CancellationToken>()))
            .Returns(() => new List<BsonDocument>().ToMockCursor().Object);
        _bannersMock.SetupFind(new List<CampaignBanner>());
        var products = new List<Product> { MakeProduct("507f1f77bcf86cd799439011") };
        _productsMock.SetupFind(products);

        var result = await _sut.GetBestsellers(6);

        var okResult = result.Result.ShouldBeOfType<OkObjectResult>();
        var value = okResult.Value.ShouldBeOfType<List<Product>>();
        value.ShouldContain(p => p.Id == "507f1f77bcf86cd799439011");
    }

    // ---------- Create ----------

    [Fact]
    public async Task Create_ReturnsCreatedAtAction_ForAValidRequest()
    {
        var request = MakeValidCreateRequest();

        var result = await _sut.Create(request);

        var created = result.Result.ShouldBeOfType<CreatedAtActionResult>();
        created.ActionName.ShouldBe(nameof(ProductsController.GetById));
        var product = created.Value.ShouldBeOfType<Product>();
        product.Name.ShouldBe("Bajra Flour");
        _productsMock.Verify(c => c.InsertOneAsync(It.IsAny<Product>(), null, It.IsAny<CancellationToken>()), Times.Once);
    }

    [Fact]
    public async Task Create_ReturnsBadRequest_WhenARequiredFieldIsMissing()
    {
        var request = MakeValidCreateRequest(name: "   ");

        var result = await _sut.Create(request);

        result.Result.ShouldBeOfType<BadRequestObjectResult>();
        _productsMock.Verify(c => c.InsertOneAsync(It.IsAny<Product>(), null, It.IsAny<CancellationToken>()), Times.Never);
    }

    [Theory]
    [InlineData(0)]
    [InlineData(100000.01)]
    public async Task Create_ReturnsBadRequest_WhenPriceIsOutOfRange(double price)
    {
        var request = MakeValidCreateRequest(price: (decimal)price);

        var result = await _sut.Create(request);

        result.Result.ShouldBeOfType<BadRequestObjectResult>();
    }

    [Theory]
    [InlineData(-1)]
    [InlineData(101)]
    public async Task Create_ReturnsBadRequest_WhenDiscountIsOutOfRange(double discount)
    {
        var request = MakeValidCreateRequest(discount: (decimal)discount);

        var result = await _sut.Create(request);

        result.Result.ShouldBeOfType<BadRequestObjectResult>();
    }

    [Fact]
    public async Task Create_StripsAngleBracketsFromTextFields()
    {
        var request = MakeValidCreateRequest(name: "<b>Bajra</b> Flour");

        var result = await _sut.Create(request);

        var created = result.Result.ShouldBeOfType<CreatedAtActionResult>();
        var product = created.Value.ShouldBeOfType<Product>();
        product.Name.ShouldBe("bBajra/b Flour");
        product.Name.ShouldNotContain("<");
        product.Name.ShouldNotContain(">");
    }

    [Fact]
    public async Task Create_TrimsAndCapsGalleryImageUrls_AtFive()
    {
        var urls = new List<string> { " one ", "two", "  ", "three", "four", "five", "six" };
        var request = MakeValidCreateRequest(galleryImageUrls: urls);

        var result = await _sut.Create(request);

        var created = result.Result.ShouldBeOfType<CreatedAtActionResult>();
        var product = created.Value.ShouldBeOfType<Product>();
        product.GalleryImageUrls.Count.ShouldBe(5);
        product.GalleryImageUrls.ShouldContain("one");
        product.GalleryImageUrls.ShouldNotContain("  ");
    }

    // ---------- Update ----------

    [Fact]
    public async Task Update_ReturnsBadRequest_WhenNoFieldsProvided()
    {
        var result = await _sut.Update("507f1f77bcf86cd799439011", new UpdateProductRequest());

        result.Result.ShouldBeOfType<BadRequestObjectResult>();
    }

    [Fact]
    public async Task Update_ReturnsNotFound_WhenProductDoesNotExist()
    {
        _productsMock.SetupFind(new List<Product>());

        var result = await _sut.Update("507f1f77bcf86cd799439011", new UpdateProductRequest { Price = 50 });

        result.Result.ShouldBeOfType<NotFoundObjectResult>();
    }

    [Fact]
    public async Task Update_AppliesOnlyProvidedFields_OnPartialMerge()
    {
        var existing = MakeProduct("507f1f77bcf86cd799439011");
        _productsMock.SetupFind(new List<Product> { existing });

        var result = await _sut.Update(existing.Id!, new UpdateProductRequest { Price = 250 });

        var okResult = result.Result.ShouldBeOfType<OkObjectResult>();
        var product = okResult.Value.ShouldBeOfType<Product>();
        product.Price.ShouldBe(250);
        product.Name.ShouldBe(existing.Name);
    }

    [Fact]
    public async Task Update_PersistsStockQuantity()
    {
        // Regression: the controller used to rebuild a sanitized request that
        // dropped StockQuantity/LowStockThreshold entirely, so neither field was
        // ever persisted no matter what the admin entered.
        var existing = MakeProduct("507f1f77bcf86cd799439011");
        existing.StockQuantity = null;
        _productsMock.SetupFind(new List<Product> { existing });

        var result = await _sut.Update(existing.Id!, new UpdateProductRequest { StockQuantity = 42, LowStockThreshold = 8 });

        var okResult = result.Result.ShouldBeOfType<OkObjectResult>();
        var product = okResult.Value.ShouldBeOfType<Product>();
        product.StockQuantity.ShouldBe(42);
        product.LowStockThreshold.ShouldBe(8);
    }

    [Fact]
    public async Task Update_LeavesStockQuantityUnchanged_WhenNotProvided()
    {
        // A partial update (e.g. toggling availability alone) must not wipe out
        // an already-tracked stock count.
        var existing = MakeProduct("507f1f77bcf86cd799439011");
        existing.StockQuantity = 15;
        _productsMock.SetupFind(new List<Product> { existing });

        var result = await _sut.Update(existing.Id!, new UpdateProductRequest { IsAvailable = false });

        var okResult = result.Result.ShouldBeOfType<OkObjectResult>();
        var product = okResult.Value.ShouldBeOfType<Product>();
        product.StockQuantity.ShouldBe(15);
    }

    [Fact]
    public async Task Update_ReturnsBadRequest_WhenPriceOutOfRangeAfterMerge()
    {
        var existing = MakeProduct("507f1f77bcf86cd799439011");
        _productsMock.SetupFind(new List<Product> { existing });

        var result = await _sut.Update(existing.Id!, new UpdateProductRequest { Price = 100000.01m });

        result.Result.ShouldBeOfType<BadRequestObjectResult>();
        _productsMock.Verify(
            c => c.ReplaceOneAsync(It.IsAny<FilterDefinition<Product>>(), It.IsAny<Product>(), It.IsAny<ReplaceOptions>(), It.IsAny<CancellationToken>()),
            Times.Never);
    }

    [Fact]
    public async Task Update_ReturnsBadRequest_WhenRequiredFieldClearedToWhitespace()
    {
        var existing = MakeProduct("507f1f77bcf86cd799439011");
        _productsMock.SetupFind(new List<Product> { existing });

        var result = await _sut.Update(existing.Id!, new UpdateProductRequest { Name = "   " });

        result.Result.ShouldBeOfType<BadRequestObjectResult>();
    }

    [Fact]
    public async Task Update_StripsAngleBracketsFromTextFields()
    {
        var existing = MakeProduct("507f1f77bcf86cd799439011");
        _productsMock.SetupFind(new List<Product> { existing });

        var result = await _sut.Update(existing.Id!, new UpdateProductRequest { Name = "<i>New</i> Name" });

        var okResult = result.Result.ShouldBeOfType<OkObjectResult>();
        var product = okResult.Value.ShouldBeOfType<Product>();
        product.Name.ShouldBe("iNew/i Name");
    }

    // ---------- Delete ----------

    [Fact]
    public async Task Delete_ReturnsNoContent_WhenProductWasDeleted()
    {
        _productsMock
            .Setup(c => c.DeleteOneAsync(It.IsAny<FilterDefinition<Product>>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync(new DeleteResult.Acknowledged(1));

        var result = await _sut.Delete("507f1f77bcf86cd799439011");

        result.ShouldBeOfType<NoContentResult>();
    }

    [Fact]
    public async Task Delete_ReturnsNotFound_WhenNothingWasDeleted()
    {
        _productsMock
            .Setup(c => c.DeleteOneAsync(It.IsAny<FilterDefinition<Product>>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync(new DeleteResult.Acknowledged(0));

        var result = await _sut.Delete("507f1f77bcf86cd799439011");

        result.ShouldBeOfType<NotFoundObjectResult>();
    }
}
