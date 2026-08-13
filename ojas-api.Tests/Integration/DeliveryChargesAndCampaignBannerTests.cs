using System.Net;
using System.Net.Http.Json;
using OjasApi.Models;
using OjasApi.Services;
using Shouldly;

namespace OjasApi.Tests.Integration;

[Collection(MongoCollectionFixture.Name)]
public class DeliveryChargesAndCampaignBannerTests : IDisposable
{
    private readonly OjasApiFactory _factory;

    public DeliveryChargesAndCampaignBannerTests(MongoRunnerFixture mongo)
    {
        _factory = new OjasApiFactory(mongo);
    }

    public void Dispose()
    {
        _factory.Dispose();
    }

    private static HttpRequestMessage Json(HttpMethod method, string url, object body, string csrf)
    {
        var request = new HttpRequestMessage(method, url) { Content = JsonContent.Create(body) };
        request.AttachCsrf(csrf);
        return request;
    }

    [Fact]
    public async Task DeliveryCharges_AdminUpsert_ThenPublicGetAndCalculate()
    {
        using var admin = _factory.CreateClient();
        var (_, csrf) = await _factory.SeedAndLoginAsStaffAsync(admin, UserRoles.Admin);

        var config = new DeliveryCharges
        {
            WarehouseAddress = "Integration Warehouse",
            WarehouseLatitude = 18.0,
            WarehouseLongitude = 73.0,
            FreeDeliveryUpToKm = 5,
            PerKmChargeAfterFree = 10,
            IsActive = true,
        };

        var upsertResponse = await admin.SendAsync(Json(HttpMethod.Patch, "/api/delivery-charges", config, csrf));
        upsertResponse.StatusCode.ShouldBe(HttpStatusCode.OK);
        var upserted = await upsertResponse.Content.ReadFromJsonAsync<DeliveryCharges>();
        upserted!.WarehouseAddress.ShouldBe("Integration Warehouse");

        using var publicClient = _factory.CreateClient();
        var getResponse = await publicClient.GetAsync("/api/delivery-charges");
        getResponse.StatusCode.ShouldBe(HttpStatusCode.OK);
        var fetched = await getResponse.Content.ReadFromJsonAsync<DeliveryCharges>();
        fetched!.WarehouseAddress.ShouldBe("Integration Warehouse");

        // 1 degree latitude north of the warehouse => distance = 6371*(pi/180) ~= 111.1949km
        var calcResponse = await publicClient.GetAsync("/api/delivery-charges/calculate?latitude=19.0&longitude=73.0");
        calcResponse.StatusCode.ShouldBe(HttpStatusCode.OK);
        var calc = await calcResponse.Content.ReadFromJsonAsync<DeliveryChargeCalculationResponse>();
        calc!.IsFree.ShouldBeFalse();
        calc.Charge.ShouldBe(1061.95m);
    }

    [Fact]
    public async Task DeliveryCharges_Customer_ForbiddenFromPatch()
    {
        using var customerClient = _factory.CreateClient();
        var (_, csrf) = await customerClient.RegisterAsync();

        var config = new DeliveryCharges
        {
            WarehouseAddress = "Hacked Warehouse",
            WarehouseLatitude = 0,
            WarehouseLongitude = 0,
            FreeDeliveryUpToKm = 100,
            PerKmChargeAfterFree = 0,
            IsActive = true,
        };

        var response = await customerClient.SendAsync(Json(HttpMethod.Patch, "/api/delivery-charges", config, csrf));

        response.StatusCode.ShouldBe(HttpStatusCode.Forbidden);
    }

    [Fact]
    public async Task CampaignBanner_AdminCreate_ThenPublicGetIncludesIt()
    {
        using var admin = _factory.CreateClient();
        var (_, csrf) = await _factory.SeedAndLoginAsStaffAsync(admin, UserRoles.Admin);

        var banner = new CampaignBanner
        {
            Title = "Integration Sale",
            Subtitle = "Big discounts",
            IsActive = true,
        };

        var createResponse = await admin.SendAsync(Json(HttpMethod.Post, "/api/campaign-banner", banner, csrf));
        createResponse.StatusCode.ShouldBe(HttpStatusCode.OK);
        var created = await createResponse.Content.ReadFromJsonAsync<CampaignBanner>();
        created!.Title.ShouldBe("Integration Sale");
        created.Id.ShouldNotBeNullOrEmpty();

        using var publicClient = _factory.CreateClient();
        var getResponse = await publicClient.GetAsync("/api/campaign-banner");
        getResponse.StatusCode.ShouldBe(HttpStatusCode.OK);
        var fetched = await getResponse.Content.ReadFromJsonAsync<List<CampaignBanner>>();
        fetched!.ShouldContain(b => b.Id == created.Id && b.Title == "Integration Sale");
    }

    [Fact]
    public async Task CampaignBanner_AdminUpdate_ThenAdminDelete_RemovesIt()
    {
        using var admin = _factory.CreateClient();
        var (_, csrf) = await _factory.SeedAndLoginAsStaffAsync(admin, UserRoles.Admin);

        var created = await admin.SendAsync(Json(HttpMethod.Post, "/api/campaign-banner", new CampaignBanner { Title = "Original" }, csrf));
        var banner = await created.Content.ReadFromJsonAsync<CampaignBanner>();

        var updateResponse = await admin.SendAsync(
            Json(HttpMethod.Patch, $"/api/campaign-banner/{banner!.Id}", new CampaignBanner { Title = "Updated" }, csrf));
        updateResponse.StatusCode.ShouldBe(HttpStatusCode.OK);
        var updated = await updateResponse.Content.ReadFromJsonAsync<CampaignBanner>();
        updated!.Id.ShouldBe(banner.Id);
        updated.Title.ShouldBe("Updated");

        var deleteRequest = new HttpRequestMessage(HttpMethod.Delete, $"/api/campaign-banner/{banner.Id}");
        deleteRequest.AttachCsrf(csrf);
        var deleteResponse = await admin.SendAsync(deleteRequest);
        deleteResponse.StatusCode.ShouldBe(HttpStatusCode.NoContent);

        using var publicClient = _factory.CreateClient();
        var getResponse = await publicClient.GetAsync("/api/campaign-banner");
        var fetched = await getResponse.Content.ReadFromJsonAsync<List<CampaignBanner>>();
        fetched!.ShouldNotContain(b => b.Id == banner.Id);
    }

    [Fact]
    public async Task CampaignBanner_Customer_ForbiddenFromCreate()
    {
        using var customerClient = _factory.CreateClient();
        var (_, csrf) = await customerClient.RegisterAsync();

        var banner = new CampaignBanner { Title = "Hacked Sale" };

        var response = await customerClient.SendAsync(Json(HttpMethod.Post, "/api/campaign-banner", banner, csrf));

        response.StatusCode.ShouldBe(HttpStatusCode.Forbidden);
    }
}
