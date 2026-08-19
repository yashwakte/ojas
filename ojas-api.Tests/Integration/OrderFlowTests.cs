using System.Net;
using System.Net.Http.Json;
using OjasApi.Models;
using OjasApi.Services;
using Shouldly;

namespace OjasApi.Tests.Integration;

[Collection(MongoCollectionFixture.Name)]
public class OrderFlowTests : IDisposable
{
    private readonly OjasApiFactory _factory;
    private readonly HttpClient _customerClient;

    public OrderFlowTests(MongoRunnerFixture mongo)
    {
        _factory = new OjasApiFactory(mongo);
        _customerClient = _factory.CreateClient();
    }

    public void Dispose()
    {
        _customerClient.Dispose();
        _factory.Dispose();
    }

    private async Task SeedDeliveryChargesAsync()
    {
        await _factory.SeedAsync(async db =>
        {
            var config = new DeliveryCharges
            {
                WarehouseAddress = "Test Warehouse",
                WarehouseLatitude = 18.0,
                WarehouseLongitude = 73.0,
                FreeDeliveryUpToKm = 5,
                PerKmChargeAfterFree = 10,
                IsActive = true,
            };
            await db.DeliveryCharges.InsertOneAsync(config);
        });
    }

    private static HttpRequestMessage PatchJson(string url, object body, string csrf)
    {
        var request = new HttpRequestMessage(HttpMethod.Patch, url) { Content = JsonContent.Create(body) };
        request.AttachCsrf(csrf);
        return request;
    }

    [Fact]
    public async Task FullOrderLifecycle_PlaceTrackAssignAndDeliver()
    {
        await SeedDeliveryChargesAsync();

        var (_, customerCsrf) = await _customerClient.RegisterAsync(fullName: "Order Customer");

        var items = new List<OrderItemDto>
        {
            new("p1", "Product One", 100, "1kg", 2),
            new("p2", "Product Two", 50, "500g", 1),
        };
        // Delivery point exactly 1 degree latitude north of the seeded warehouse => distance = 6371*(pi/180) ~= 111.1949km
        var placeRequest = new PlaceOrderRequest("Order Customer", "9123456789", "123 Main St", 19.0, 73.0, "Ring bell", items);
        var placeHttpRequest = new HttpRequestMessage(HttpMethod.Post, "/api/orders") { Content = JsonContent.Create(placeRequest) };
        placeHttpRequest.AttachCsrf(customerCsrf);

        var placeResponse = await _customerClient.SendAsync(placeHttpRequest);
        placeResponse.StatusCode.ShouldBe(HttpStatusCode.OK);
        var placedOrder = await placeResponse.Content.ReadFromJsonAsync<OrderResponse>();
        placedOrder.ShouldNotBeNull();
        placedOrder!.DeliveryCharge.ShouldBe(1061.95m);
        placedOrder.TotalAmount.ShouldBe(250m + 1061.95m);
        placedOrder.Status.ShouldBe("Pending");
        placedOrder.PaymentMethod.ShouldBe("COD");
        placedOrder.PaymentStatus.ShouldBe("Pending");

        // Customer can see it in "my orders"
        var myOrdersResponse = await _customerClient.GetAsync("/api/orders/my");
        myOrdersResponse.StatusCode.ShouldBe(HttpStatusCode.OK);
        var myOrders = await myOrdersResponse.Content.ReadFromJsonAsync<List<OrderResponse>>();
        myOrders.ShouldNotBeNull();
        myOrders!.ShouldContain(o => o.Id == placedOrder.Id);

        // Admin updates status and assigns a delivery partner
        using var adminClient = _factory.CreateClient();
        var (_, adminCsrf) = await _factory.SeedAndLoginAsStaffAsync(adminClient, UserRoles.Admin);

        var statusUpdateResponse = await adminClient.SendAsync(
            PatchJson($"/api/orders/admin/{placedOrder.Id}/status", new UpdateOrderStatusRequest("Confirmed"), adminCsrf));
        statusUpdateResponse.StatusCode.ShouldBe(HttpStatusCode.NoContent);

        using var deliveryClient = _factory.CreateClient();
        var (deliveryAuth, deliveryCsrf) = await _factory.SeedAndLoginAsStaffAsync(deliveryClient, UserRoles.Delivery);

        var assignResponse = await adminClient.SendAsync(
            PatchJson($"/api/orders/admin/{placedOrder.Id}/assign", new AssignDeliveryPartnerRequest(deliveryAuth.Id), adminCsrf));
        assignResponse.StatusCode.ShouldBe(HttpStatusCode.NoContent);

        // A different delivery partner cannot mark it delivered
        using var otherDeliveryClient = _factory.CreateClient();
        var (_, otherDeliveryCsrf) = await _factory.SeedAndLoginAsStaffAsync(otherDeliveryClient, UserRoles.Delivery);
        var forbiddenAttempt = await otherDeliveryClient.SendAsync(
            PatchJson($"/api/orders/delivery/{placedOrder.Id}/delivered", new { }, otherDeliveryCsrf));
        forbiddenAttempt.StatusCode.ShouldBe(HttpStatusCode.Forbidden);

        // The assigned delivery partner can mark it delivered
        var deliveredResponse = await deliveryClient.SendAsync(
            PatchJson($"/api/orders/delivery/{placedOrder.Id}/delivered", new { }, deliveryCsrf));
        deliveredResponse.StatusCode.ShouldBe(HttpStatusCode.NoContent);

        var assignedOrders = await deliveryClient.GetFromJsonAsync<List<OrderResponse>>("/api/orders/delivery/my");
        assignedOrders.ShouldNotBeNull();
        assignedOrders!.ShouldContain(o => o.Id == placedOrder.Id && o.Status == "Delivered");
    }

    /// <summary>Payment collection is tracked separately from delivery status - a partner can
    /// hand over the goods without successfully collecting cash, so the two must be settable
    /// independently rather than one implying the other.</summary>
    [Fact]
    public async Task PaymentCollection_IsIndependentOfDeliveryStatus_AndOnlyTheAssignedPartnerCanRecordIt()
    {
        await SeedDeliveryChargesAsync();

        var (_, customerCsrf) = await _customerClient.RegisterAsync(fullName: "COD Customer");
        var items = new List<OrderItemDto> { new("p1", "Product One", 100, "1kg", 1) };
        var placeRequest = new PlaceOrderRequest("COD Customer", "9123456789", "123 Main St", 19.0, 73.0, "", items);
        var placeHttpRequest = new HttpRequestMessage(HttpMethod.Post, "/api/orders") { Content = JsonContent.Create(placeRequest) };
        placeHttpRequest.AttachCsrf(customerCsrf);
        var placeResponse = await _customerClient.SendAsync(placeHttpRequest);
        var placedOrder = (await placeResponse.Content.ReadFromJsonAsync<OrderResponse>())!;

        using var adminClient = _factory.CreateClient();
        var (_, adminCsrf) = await _factory.SeedAndLoginAsStaffAsync(adminClient, UserRoles.Admin);

        using var deliveryClient = _factory.CreateClient();
        var (deliveryAuth, deliveryCsrf) = await _factory.SeedAndLoginAsStaffAsync(deliveryClient, UserRoles.Delivery);
        await adminClient.SendAsync(
            PatchJson($"/api/orders/admin/{placedOrder.Id}/assign", new AssignDeliveryPartnerRequest(deliveryAuth.Id), adminCsrf));

        // A different delivery partner cannot record the collection.
        using var otherDeliveryClient = _factory.CreateClient();
        var (_, otherDeliveryCsrf) = await _factory.SeedAndLoginAsStaffAsync(otherDeliveryClient, UserRoles.Delivery);
        var forbiddenAttempt = await otherDeliveryClient.SendAsync(
            PatchJson($"/api/orders/delivery/{placedOrder.Id}/payment-collected", new { }, otherDeliveryCsrf));
        forbiddenAttempt.StatusCode.ShouldBe(HttpStatusCode.Forbidden);

        // Marking payment collected does not, by itself, mark the order Delivered.
        var collectedResponse = await deliveryClient.SendAsync(
            PatchJson($"/api/orders/delivery/{placedOrder.Id}/payment-collected", new { }, deliveryCsrf));
        collectedResponse.StatusCode.ShouldBe(HttpStatusCode.NoContent);

        var assignedOrders = await deliveryClient.GetFromJsonAsync<List<OrderResponse>>("/api/orders/delivery/my");
        var afterCollection = assignedOrders!.Single(o => o.Id == placedOrder.Id);
        afterCollection.PaymentStatus.ShouldBe("Collected");
        afterCollection.Status.ShouldBe("Pending");

        // Idempotent: calling it again after collection is already recorded is a no-op, not an error.
        var repeatResponse = await deliveryClient.SendAsync(
            PatchJson($"/api/orders/delivery/{placedOrder.Id}/payment-collected", new { }, deliveryCsrf));
        repeatResponse.StatusCode.ShouldBe(HttpStatusCode.NoContent);
    }
}
