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

    private static CreateProductRequest MakeValidRequest(string category, string name = "Bajra Flour") => new()
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
}
