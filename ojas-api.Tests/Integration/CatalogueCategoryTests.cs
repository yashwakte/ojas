using MongoDB.Driver;
using OjasApi.Models;
using OjasApi.Services;
using Shouldly;

namespace OjasApi.Tests.Integration;

/// <summary>
/// The September 2026 category change, run against a real MongoDB. Live products were filed under
/// Flour, Grains, Health Mix, Premium Atta and Powder Box; the boot migration moves each into its
/// new aisle, and must never undo a category the owner has since chosen themselves.
/// </summary>
[Collection(MongoCollectionFixture.Name)]
public class CatalogueCategoryTests : IDisposable
{
    private readonly OjasApiFactory _factory;

    public CatalogueCategoryTests(MongoRunnerFixture mongo)
    {
        _factory = new OjasApiFactory(mongo);
    }

    public void Dispose() => _factory.Dispose();

    private static Product Make(string name, string category) => new()
    {
        Name = name,
        Description = "Seeded for tests",
        Price = 50m,
        Category = category,
        Weight = "500g",
    };

    /// <summary>
    /// Program.cs seeds the catalogue on a fire-and-forget task at startup, and that seed only
    /// inserts into an EMPTY collection. Clearing the collection before it has run lets it insert
    /// the whole catalogue afterwards, duplicating the very products under test - so wait for it.
    /// </summary>
    private static async Task WaitForStartupSeedAsync(IMongoDbService db)
    {
        for (var i = 0; i < 200 && await db.Products.CountDocumentsAsync(_ => true) == 0; i++)
        {
            await Task.Delay(50);
        }
    }

    /// <summary>Replaces the catalogue with these products, runs the boot migration, returns the
    /// result keyed by name.</summary>
    private async Task<Dictionary<string, string>> MigrateAsync(params Product[] products)
    {
        var categories = new Dictionary<string, string>();
        await _factory.SeedAsync(async db =>
        {
            await WaitForStartupSeedAsync(db);
            await db.Products.DeleteManyAsync(_ => true);
            await db.Products.InsertManyAsync(products);

            await new ProductService(db).MigrateLegacyProductsAsync();

            var after = await db.Products.Find(_ => true).ToListAsync();
            foreach (var p in after) categories[p.Name] = p.Category;
        });
        return categories;
    }

    [Fact]
    public async Task MovesEachLiveProductIntoItsNewAisle()
    {
        var result = await MigrateAsync(
            Make("Sorghum Flour", "Flour"),
            Make("Modak Pith", "Flour"),
            Make("Anarasa Flour", "Flour"),
            Make("Wheat Daliya", "Grains"),
            Make("Chana Sattu", "Health Mix"),
            Make("Custard Powder - Mango Flavour", "Powder Box"),
            Make("Corn Flour", "Powder Box"),
            Make("Cinnamon Powder", "Powder Box"),
            Make("Rock Salt", "Powder Box"));

        result["Sorghum Flour"].ShouldBe("Everyday Flours");
        // Flour was too broad to translate on its own: the festive flours go to their own aisle.
        result["Modak Pith"].ShouldBe("Traditional & Festive");
        result["Anarasa Flour"].ShouldBe("Traditional & Festive");
        result["Wheat Daliya"].ShouldBe("Health & Breakfast");
        result["Chana Sattu"].ShouldBe("Health & Breakfast");
        result["Custard Powder - Mango Flavour"].ShouldBe("Baking & Desserts");
        result["Corn Flour"].ShouldBe("Baking & Desserts");
        // ...and so was Powder Box: spices are not baking goods.
        result["Cinnamon Powder"].ShouldBe("Spices & Essentials");
        result["Rock Salt"].ShouldBe("Upwas");
    }

    [Fact]
    public async Task AProductItDoesNotKnowByName_FollowsItsOldCategory()
    {
        // One the owner added through the admin console, under a category that has since gone.
        var result = await MigrateAsync(
            Make("Khapli Wheat Atta", "Premium Atta"),
            Make("Rose Syrup", "Powder Box"),
            Make("Multigrain Mix", "Health Mix"));

        result["Khapli Wheat Atta"].ShouldBe("Everyday Flours");
        result["Rose Syrup"].ShouldBe("Baking & Desserts");
        result["Multigrain Mix"].ShouldBe("Health & Breakfast");
    }

    [Fact]
    public async Task NeverMovesAProductTheOwnerHasAlreadyFiled()
    {
        // The owner has deliberately put Modak Pith in Upwas. Running on every boot is only safe
        // because a category that is not a retired one is left exactly where it is.
        var result = await MigrateAsync(
            Make("Modak Pith", "Upwas"),
            Make("Corn Flour", "Spices & Essentials"));

        result["Modak Pith"].ShouldBe("Upwas");
        result["Corn Flour"].ShouldBe("Spices & Essentials");
    }

    [Fact]
    public async Task RunningItAgainChangesNothing()
    {
        await MigrateAsync(Make("Bajra Flour", "Flour"), Make("Baking Soda", "Powder Box"));

        var second = new Dictionary<string, string>();
        await _factory.SeedAsync(async db =>
        {
            await new ProductService(db).MigrateLegacyProductsAsync();
            foreach (var p in await db.Products.Find(_ => true).ToListAsync()) second[p.Name] = p.Category;
        });

        second["Bajra Flour"].ShouldBe("Everyday Flours");
        second["Baking Soda"].ShouldBe("Baking & Desserts");
    }
}
