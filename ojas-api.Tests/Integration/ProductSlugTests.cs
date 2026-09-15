using System.Net;
using System.Net.Http.Json;
using MongoDB.Driver;
using OjasApi.Models;
using OjasApi.Services;
using Shouldly;

namespace OjasApi.Tests.Integration;

/// <summary>
/// Readable product addresses (/products/modak-pith) and the sitemap built from them, against a
/// real MongoDB — the unique index and the backfill's "never move an address" rule only mean
/// anything against the real thing.
///
/// The product names here are ones the pack seed never uses, so the startup seed running beside
/// these tests cannot take their addresses first.
/// </summary>
[Collection(MongoCollectionFixture.Name)]
public class ProductSlugTests : IDisposable
{
    private readonly OjasApiFactory _factory;

    public ProductSlugTests(MongoRunnerFixture mongo)
    {
        _factory = new OjasApiFactory(mongo);
    }

    public void Dispose() => _factory.Dispose();

    private static Product Make(
        string name,
        bool listed = true,
        string? slug = null,
        DateTime? createdAt = null,
        string category = "Traditional & Festive") => new()
    {
        Name = name,
        Description = "Seeded for slug tests",
        Price = 60m,
        Category = category,
        Weight = "500g",
        ImageUrl = "/images/kokum-front.webp",
        GalleryImageUrls = ["/images/kokum-back.webp"],
        IsListed = listed,
        Slug = slug,
        CreatedAt = createdAt ?? DateTime.UtcNow,
    };

    /// <summary>See CatalogueCategoryTests: the startup seed only fills an EMPTY collection, so
    /// clearing it before the seed has run would let it insert the catalogue on top of these.</summary>
    private static async Task WaitForStartupSeedAsync(IMongoDbService db)
    {
        for (var i = 0; i < 200 && await db.Products.CountDocumentsAsync(_ => true) == 0; i++)
        {
            await Task.Delay(50);
        }
    }

    /// <summary>Replaces the catalogue with these products, runs the boot migration, and returns
    /// what each of them ended up with.</summary>
    private async Task<List<Product>> BackfillAsync(params Product[] products)
    {
        var names = products.Select(p => p.Name).ToHashSet();
        var after = new List<Product>();
        await _factory.SeedAsync(async db =>
        {
            await WaitForStartupSeedAsync(db);
            await db.Products.DeleteManyAsync(_ => true);
            await db.Products.InsertManyAsync(products);

            await new ProductService(db).MigrateLegacyProductsAsync();

            after = (await db.Products.Find(_ => true).ToListAsync())
                .Where(p => names.Contains(p.Name))
                .ToList();
        });
        return after;
    }

    [Fact]
    public async Task Backfill_GivesEveryProductAReadableAddress()
    {
        var after = await BackfillAsync(
            Make("Kokum Sherbet Mix"),
            Make("Rajgira Ladoo (Amaranth) Mix"));

        after.Single(p => p.Name == "Kokum Sherbet Mix").Slug.ShouldBe("kokum-sherbet-mix");
        after.Single(p => p.Name == "Rajgira Ladoo (Amaranth) Mix").Slug.ShouldBe("rajgira-ladoo-amaranth-mix");
    }

    [Fact]
    public async Task Backfill_LetsTheListedProductKeepThePlainAddress_WhenTwoShareAName()
    {
        // The unlisted draft is the older one, so "oldest first" alone would hand it the plain
        // address — and leave the product customers can actually see on "-2".
        var after = await BackfillAsync(
            Make("Kokum Sherbet Mix", listed: false, createdAt: DateTime.UtcNow.AddDays(-3)),
            Make("Kokum Sherbet Mix", listed: true, createdAt: DateTime.UtcNow));

        after.Single(p => p.IsListed).Slug.ShouldBe("kokum-sherbet-mix");
        after.Single(p => !p.IsListed).Slug.ShouldBe("kokum-sherbet-mix-2");
    }

    [Fact]
    public async Task Backfill_NeverMovesAnAddressAlreadyGiven()
    {
        // Renamed since it was given its address. The address must not follow the name, or every
        // link already shared would break.
        var after = await BackfillAsync(Make("Kokum Sherbet Concentrate", slug: "kokum-sherbet-mix"));

        after.Single().Slug.ShouldBe("kokum-sherbet-mix");
    }

    [Fact]
    public async Task Create_NumbersTheAddress_WhenTheNameIsAlreadyTaken()
    {
        await BackfillAsync(Make("Kokum Sherbet Mix"));

        Product created = null!;
        await _factory.SeedAsync(async db =>
        {
            created = await new ProductService(db).CreateAsync(Make("Kokum Sherbet Mix"));
        });

        created.Slug.ShouldBe("kokum-sherbet-mix-2");
    }

    [Fact]
    public async Task Api_AnswersByAddressOrId_And404sAnythingElse()
    {
        var after = await BackfillAsync(Make("Kokum Sherbet Mix"), Make("Amla Candy Draft", listed: false));
        var id = after.Single(p => p.Name == "Kokum Sherbet Mix").Id!;
        var client = _factory.CreateClient();

        var bySlug = await client.GetAsync("/api/products/kokum-sherbet-mix");
        bySlug.StatusCode.ShouldBe(HttpStatusCode.OK);
        (await bySlug.Content.ReadFromJsonAsync<Product>())!.Name.ShouldBe("Kokum Sherbet Mix");

        var byId = await client.GetAsync($"/api/products/{id}");
        byId.StatusCode.ShouldBe(HttpStatusCode.OK);
        (await byId.Content.ReadFromJsonAsync<Product>())!.Slug.ShouldBe("kokum-sherbet-mix");

        // A shared link with capitals in it still lands on the product.
        (await client.GetAsync("/api/products/Kokum-Sherbet-Mix")).StatusCode.ShouldBe(HttpStatusCode.OK);

        // Used to be a 500: anything that is not an id was handed to the id filter and threw.
        (await client.GetAsync("/api/products/no-such-product")).StatusCode.ShouldBe(HttpStatusCode.NotFound);

        // A draft stays invisible to customers by address just as it does by id.
        (await client.GetAsync("/api/products/amla-candy-draft")).StatusCode.ShouldBe(HttpStatusCode.NotFound);
    }

    [Fact]
    public async Task Sitemap_ListsTheListedProductsAndTheirAisles()
    {
        await BackfillAsync(
            Make("Kokum Sherbet Mix"),
            Make("Amla Candy Draft", listed: false, category: "Upwas"));
        var client = _factory.CreateClient();

        var response = await client.GetAsync("/api/seo/sitemap.xml");

        response.StatusCode.ShouldBe(HttpStatusCode.OK);
        response.Content.Headers.ContentType!.MediaType.ShouldBe("application/xml");
        response.Headers.GetValues("Vercel-CDN-Cache-Control").Single().ShouldContain("max-age=3600");

        var xml = await response.Content.ReadAsStringAsync();
        xml.ShouldContain("<loc>https://www.ojasaata.com/products/kokum-sherbet-mix</loc>");
        xml.ShouldContain("<image:loc>https://www.ojasaata.com/images/kokum-front.webp</image:loc>");
        xml.ShouldContain("<loc>https://www.ojasaata.com/products?category=Traditional%20%26%20Festive</loc>");

        // The draft is neither listed itself nor enough to open its aisle.
        xml.ShouldNotContain("amla-candy-draft");
        xml.ShouldNotContain("category=Upwas");
    }
}
