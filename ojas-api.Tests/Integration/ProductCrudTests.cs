using System.Net;
using System.Net.Http.Json;
using OjasApi.Models;
using OjasApi.Services;
using Shouldly;

namespace OjasApi.Tests.Integration;

[Collection(MongoCollectionFixture.Name)]
public class ProductCrudTests : IDisposable
{
    private readonly OjasApiFactory _factory;

    public ProductCrudTests(MongoRunnerFixture mongo)
    {
        _factory = new OjasApiFactory(mongo);
    }

    public void Dispose()
    {
        _factory.Dispose();
    }

    private static CreateProductRequest MakeValidRequest(
        string category,
        string name = "Bajra Flour",
        bool isListed = true) => new()
    {
        Name = name,
        Description = "An integration-test product description that is long enough.",
        Price = 100,
        Discount = 0,
        Category = category,
        ImageUrl = "/images/test.jpg",
        GalleryImageUrls = [],
        Weight = "500g",
        IsAvailable = true,
        IsListed = isListed,
        Ingredients = "Bajra grain",
        Benefits = "Good source of fiber",
        StorageInfo = "Store in a cool, dry place.",
    };

    private async Task<(HttpClient Client, string Csrf)> CreateAdminClientAsync()
    {
        var client = _factory.CreateClient();
        var (_, csrf) = await _factory.SeedAndLoginAsStaffAsync(client, UserRoles.Admin);
        return (client, csrf);
    }

    private static HttpRequestMessage Json(HttpMethod method, string url, object body, string csrf)
    {
        var request = new HttpRequestMessage(method, url) { Content = JsonContent.Create(body) };
        request.AttachCsrf(csrf);
        return request;
    }

    [Fact]
    public async Task AdminCrudLifecycle_CreateGetUpdateDeleteThen404()
    {
        var category = $"IntegrationTest-{Guid.NewGuid():N}";
        var (admin, csrf) = await CreateAdminClientAsync();

        var createResponse = await admin.SendAsync(Json(HttpMethod.Post, "/api/products", MakeValidRequest(category), csrf));
        createResponse.StatusCode.ShouldBe(HttpStatusCode.Created);
        var created = await createResponse.Content.ReadFromJsonAsync<Product>();
        created.ShouldNotBeNull();
        created!.Id.ShouldNotBeNullOrWhiteSpace();

        var getResponse = await admin.GetAsync($"/api/products/{created.Id}");
        getResponse.StatusCode.ShouldBe(HttpStatusCode.OK);
        var fetched = await getResponse.Content.ReadFromJsonAsync<Product>();
        fetched!.Name.ShouldBe("Bajra Flour");

        var updateResponse = await admin.SendAsync(
            Json(HttpMethod.Patch, $"/api/products/{created.Id}", new UpdateProductRequest { Price = 199 }, csrf));
        updateResponse.StatusCode.ShouldBe(HttpStatusCode.OK);
        var updated = await updateResponse.Content.ReadFromJsonAsync<Product>();
        updated!.Price.ShouldBe(199);
        updated.Name.ShouldBe("Bajra Flour");

        var deleteResponse = await admin.SendAsync(Json(HttpMethod.Delete, $"/api/products/{created.Id}", new { }, csrf));
        deleteResponse.StatusCode.ShouldBe(HttpStatusCode.NoContent);

        var afterDeleteResponse = await admin.GetAsync($"/api/products/{created.Id}");
        afterDeleteResponse.StatusCode.ShouldBe(HttpStatusCode.NotFound);
    }

    [Fact]
    public async Task Customer_ForbiddenFrom_CreateUpdateDelete()
    {
        var category = $"IntegrationTest-{Guid.NewGuid():N}";
        var (admin, adminCsrf) = await CreateAdminClientAsync();
        var createResponse = await admin.SendAsync(Json(HttpMethod.Post, "/api/products", MakeValidRequest(category), adminCsrf));
        var created = await createResponse.Content.ReadFromJsonAsync<Product>();

        using var customerClient = _factory.CreateClient();
        var (_, customerCsrf) = await customerClient.RegisterAsync();

        var createAttempt = await customerClient.SendAsync(Json(HttpMethod.Post, "/api/products", MakeValidRequest(category), customerCsrf));
        createAttempt.StatusCode.ShouldBe(HttpStatusCode.Forbidden);

        var updateAttempt = await customerClient.SendAsync(
            Json(HttpMethod.Patch, $"/api/products/{created!.Id}", new UpdateProductRequest { Price = 1 }, customerCsrf));
        updateAttempt.StatusCode.ShouldBe(HttpStatusCode.Forbidden);

        var deleteAttempt = await customerClient.SendAsync(Json(HttpMethod.Delete, $"/api/products/{created.Id}", new { }, customerCsrf));
        deleteAttempt.StatusCode.ShouldBe(HttpStatusCode.Forbidden);
    }

    [Fact]
    public async Task Bestsellers_ClampsLimit_ToBetweenOneAndTwentyFour()
    {
        // No sales data (no orders), no campaign banner fallback => GetBestsellersAsync backfills purely
        // from available products sorted by CreatedAt, capped by the *clamped* limit. Seeding 30 unique,
        // available products under a GUID category (so nothing else in the ever-reseeded demo catalog can
        // interfere) lets us observe the controller's Math.Clamp(limit, 1, 24) boundary against real Mongo
        // Limit() semantics, which the mocked unit tests can't exercise.
        var category = $"IntegrationTest-{Guid.NewGuid():N}";
        var (admin, csrf) = await CreateAdminClientAsync();
        for (var i = 0; i < 30; i++)
        {
            var response = await admin.SendAsync(Json(HttpMethod.Post, "/api/products", MakeValidRequest(category, name: $"Product {i}"), csrf));
            response.StatusCode.ShouldBe(HttpStatusCode.Created);
        }

        var overLimitResponse = await admin.GetAsync("/api/products/bestsellers?limit=999");
        overLimitResponse.StatusCode.ShouldBe(HttpStatusCode.OK);
        var overLimitProducts = await overLimitResponse.Content.ReadFromJsonAsync<List<Product>>();
        overLimitProducts!.Count.ShouldBe(24);

        var underLimitResponse = await admin.GetAsync("/api/products/bestsellers?limit=0");
        underLimitResponse.StatusCode.ShouldBe(HttpStatusCode.OK);
        var underLimitProducts = await underLimitResponse.Content.ReadFromJsonAsync<List<Product>>();
        underLimitProducts!.Count.ShouldBe(1);
    }

    /// <summary>
    /// A product that has not been listed must be invisible to customers everywhere — the
    /// catalogue, its own page, and its category — while staying fully visible to the admin who
    /// has to price it and put it on sale.
    ///
    /// This is the guarantee that lets the September 2026 photography ship ahead of its prices.
    /// Fourteen new packs went into the catalogue with Price = 0 so the owner would have something
    /// to open and price rather than a blank form; if any of them leaked onto the storefront, the
    /// shop would be offering food at nothing, which is worse than not offering it at all.
    /// </summary>
    [Fact]
    public async Task UnlistedProduct_IsHiddenFromCustomersAndVisibleToAdmin()
    {
        var category = $"IntegrationTest-{Guid.NewGuid():N}";
        var (admin, csrf) = await CreateAdminClientAsync();

        var request = MakeValidRequest(category, "Awaiting A Price", isListed: false);
        var createResponse = await admin.SendAsync(Json(HttpMethod.Post, "/api/products", request, csrf));
        createResponse.StatusCode.ShouldBe(HttpStatusCode.Created);
        var created = await createResponse.Content.ReadFromJsonAsync<Product>();
        created.ShouldNotBeNull();
        created!.IsListed.ShouldBeFalse();

        // A customer — here, anyone not signed in as an admin — must not find it anywhere.
        var anonymous = _factory.CreateClient();

        var catalogue = await anonymous.GetFromJsonAsync<List<Product>>("/api/products");
        catalogue.ShouldNotBeNull();
        catalogue!.ShouldNotContain(p => p.Id == created.Id);

        var byCategory = await anonymous.GetFromJsonAsync<List<Product>>($"/api/products/category/{category}");
        byCategory.ShouldNotBeNull();
        byCategory!.ShouldBeEmpty();

        // Its own page 404s rather than rendering at a price nobody set.
        var direct = await anonymous.GetAsync($"/api/products/{created.Id}");
        direct.StatusCode.ShouldBe(HttpStatusCode.NotFound);

        // The admin still sees it, which is the entire point of it existing.
        var adminCatalogue = await admin.GetFromJsonAsync<List<Product>>("/api/products");
        adminCatalogue.ShouldNotBeNull();
        adminCatalogue!.ShouldContain(p => p.Id == created.Id);

        var adminDirect = await admin.GetAsync($"/api/products/{created.Id}");
        adminDirect.StatusCode.ShouldBe(HttpStatusCode.OK);
    }

    /// <summary>
    /// Listing a product is what puts it on sale, and it has to work from the admin console's
    /// ordinary update — one PATCH, no special endpoint.
    /// </summary>
    [Fact]
    public async Task ListingAProduct_PutsItOnTheStorefront()
    {
        var category = $"IntegrationTest-{Guid.NewGuid():N}";
        var (admin, csrf) = await CreateAdminClientAsync();

        var request = MakeValidRequest(category, "Ready When Priced", isListed: false);
        var created = await (await admin.SendAsync(Json(HttpMethod.Post, "/api/products", request, csrf)))
            .Content.ReadFromJsonAsync<Product>();
        created.ShouldNotBeNull();

        var patch = await admin.SendAsync(Json(
            HttpMethod.Patch,
            $"/api/products/{created!.Id}",
            new UpdateProductRequest { Price = 75, IsListed = true },
            csrf));
        patch.StatusCode.ShouldBe(HttpStatusCode.OK);

        var anonymous = _factory.CreateClient();
        var byCategory = await anonymous.GetFromJsonAsync<List<Product>>($"/api/products/category/{category}");
        byCategory.ShouldNotBeNull();
        byCategory!.ShouldContain(p => p.Id == created.Id);
    }
}
