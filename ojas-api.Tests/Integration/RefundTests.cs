using System.Net;
using System.Net.Http.Json;
using MongoDB.Driver;
using OjasApi.Models;
using Shouldly;

namespace OjasApi.Tests.Integration;

/// <summary>
/// The admin refund endpoint moves real money out of the business, so what it will and won't pay
/// out is checked against real MongoDB rather than a mocked collection: the cap lives in the
/// update's own filter, and only a real database enforces that.
/// </summary>
[Collection(MongoCollectionFixture.Name)]
public class RefundTests : IDisposable
{
    private readonly OjasApiFactory _factory;
    private readonly HttpClient _customerClient;

    public RefundTests(MongoRunnerFixture mongo)
    {
        _factory = new OjasApiFactory(mongo);
        _customerClient = _factory.CreateClient();
    }

    public void Dispose()
    {
        _customerClient.Dispose();
        _factory.Dispose();
    }

    private const double Lat = 18.0;
    private const double Lng = 73.0;

    /// <summary>An order that has genuinely captured money, which is the only kind refundable.</summary>
    private string _customerCsrf = string.Empty;

    private async Task<OrderResponse> PlaceAndPayAsync(decimal price = 100m, int quantity = 6)
    {
        await _factory.SeedAsync(async db => await db.DeliveryCharges.InsertOneAsync(new DeliveryCharges
        {
            WarehouseAddress = "Test Warehouse",
            WarehouseLatitude = Lat,
            WarehouseLongitude = Lng,
            FreeDeliveryUpToKm = 5,
            PerKmChargeAfterFree = 10,
            IsActive = true,
        }));
        var product = await _factory.SeedProductAsync(price: price);
        var (_, csrf) = await _customerClient.RegisterAsync(fullName: "Refund Customer");
        _customerCsrf = csrf;

        var request = new HttpRequestMessage(HttpMethod.Post, "/api/orders")
        {
            Content = JsonContent.Create(new PlaceOrderRequest(
                "Refund Customer", "9123456789", "123 Main St", Lat, Lng, "",
                [new(product.Id!, product.Name, product.Price, product.Weight, quantity)])),
        };
        request.AttachCsrf(csrf);
        var order = (await (await _customerClient.SendAsync(request))
            .Content.ReadFromJsonAsync<OrderResponse>())!;

        _factory.Cashfree.PayAllOutstanding();
        (await _customerClient.GetAsync($"/api/payments/cashfree/status/{order.Id}"))
            .StatusCode.ShouldBe(HttpStatusCode.OK);

        return order;
    }

    private static HttpRequestMessage RefundRequest(string orderId, decimal amount, string csrf)
    {
        var request = new HttpRequestMessage(HttpMethod.Post, $"/api/orders/admin/{orderId}/refund")
        {
            Content = JsonContent.Create(new RefundOrderRequest(amount)),
        };
        request.AttachCsrf(csrf);
        return request;
    }

    private async Task<decimal> RefundedOnAsync(string orderId)
    {
        var refunded = 0m;
        await _factory.SeedAsync(async db =>
        {
            var order = await db.Orders.Find(o => o.Id == orderId).FirstOrDefaultAsync();
            refunded = order?.AmountRefunded ?? 0m;
        });
        return refunded;
    }

    [Fact]
    public async Task RefundingMoreThanTheOrderCaptured_IsRefusedAndPaysOutNothing()
    {
        var order = await PlaceAndPayAsync(); // 600 captured
        using var admin = _factory.CreateClient();
        var (_, csrf) = await _factory.SeedAndLoginAsStaffAsync(admin, UserRoles.Admin);

        var response = await admin.SendAsync(RefundRequest(order.Id, 900m, csrf));

        response.StatusCode.ShouldBe(HttpStatusCode.BadRequest);
        (await RefundedOnAsync(order.Id)).ShouldBe(0m);
    }

    /// <summary>
    /// Several refunds fired at once — what an admin double-clicking stumbles into, and what a
    /// compromised admin account would do deliberately. Reading what the order holds and paying
    /// out afterwards let each of them see the full balance and each send money, so an order
    /// could be refunded several times over what it ever captured.
    /// </summary>
    [Fact]
    public async Task SeveralRefundsAtOnce_PayOutOnlyWhatWasCaptured()
    {
        var order = await PlaceAndPayAsync(); // 600 captured
        using var admin = _factory.CreateClient();
        var (_, csrf) = await _factory.SeedAndLoginAsStaffAsync(admin, UserRoles.Admin);

        var attempts = Enumerable.Range(0, 8)
            .Select(_ => admin.SendAsync(RefundRequest(order.Id, 600m, csrf)))
            .ToArray();
        await Task.WhenAll(attempts);

        attempts.Count(a => a.Result.StatusCode == HttpStatusCode.OK).ShouldBe(1);
        (await RefundedOnAsync(order.Id)).ShouldBe(600m);
    }

    [Fact]
    public async Task RefundingInSlices_StopsOnceTheCapturedAmountIsExhausted()
    {
        var order = await PlaceAndPayAsync(); // 600
        using var admin = _factory.CreateClient();
        var (_, csrf) = await _factory.SeedAndLoginAsStaffAsync(admin, UserRoles.Admin);

        (await admin.SendAsync(RefundRequest(order.Id, 400m, csrf)))
            .StatusCode.ShouldBe(HttpStatusCode.OK);
        (await admin.SendAsync(RefundRequest(order.Id, 200m, csrf)))
            .StatusCode.ShouldBe(HttpStatusCode.OK);

        // Nothing left to give back.
        (await admin.SendAsync(RefundRequest(order.Id, 1m, csrf)))
            .StatusCode.ShouldBe(HttpStatusCode.BadRequest);
        (await RefundedOnAsync(order.Id)).ShouldBe(600m);
    }

    /// <summary>Refunds are admin-only. A customer aiming this at their own order must get
    /// nowhere near the payout path.</summary>
    [Fact]
    public async Task ACustomerCannotRefundTheirOwnOrder()
    {
        var order = await PlaceAndPayAsync();

        // The customer's own authenticated session, aimed at the admin-only payout endpoint.
        var response = await _customerClient.SendAsync(RefundRequest(order.Id, 600m, _customerCsrf));

        response.StatusCode.ShouldBeOneOf(HttpStatusCode.Forbidden, HttpStatusCode.Unauthorized);
        (await RefundedOnAsync(order.Id)).ShouldBe(0m);
    }
}
