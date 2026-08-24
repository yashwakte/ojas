using System.Net;
using System.Net.Http.Json;
using MongoDB.Driver;
using OjasApi.Models;
using Shouldly;

namespace OjasApi.Tests.Integration;

/// <summary>
/// The order endpoints seen from the outside, by someone crafting requests rather than clicking
/// buttons. Everything the browser sends is attacker-controlled: ids, prices, quantities,
/// coordinates and coupon codes. These pin the rules that stop that being worth doing.
/// </summary>
[Collection(MongoCollectionFixture.Name)]
public class OrderAttackSurfaceTests : IDisposable
{
    private readonly OjasApiFactory _factory;
    private readonly HttpClient _victim;
    private readonly HttpClient _attacker;

    public OrderAttackSurfaceTests(MongoRunnerFixture mongo)
    {
        _factory = new OjasApiFactory(mongo);
        _victim = _factory.CreateClient();
        _attacker = _factory.CreateClient();
    }

    public void Dispose()
    {
        _victim.Dispose();
        _attacker.Dispose();
        _factory.Dispose();
    }

    private const double Lat = 18.0;
    private const double Lng = 73.0;

    private string _victimCsrf = string.Empty;
    private string _attackerCsrf = string.Empty;
    private Product _product = null!;

    private async Task SetUpAsync()
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
        _product = await _factory.SeedProductAsync(price: 100m);
        _victimCsrf = (await _victim.RegisterAsync(fullName: "Victim")).CsrfToken;
        _attackerCsrf = (await _attacker.RegisterAsync(fullName: "Attacker")).CsrfToken;
    }

    private List<OrderItemDto> Items(int quantity, decimal claimedPrice = 100m) =>
        [new(_product.Id!, _product.Name, claimedPrice, _product.Weight, quantity)];

    private async Task<OrderResponse> PlaceAsync(HttpClient client, string csrf, List<OrderItemDto> items)
    {
        var request = new HttpRequestMessage(HttpMethod.Post, "/api/orders")
        {
            Content = JsonContent.Create(new PlaceOrderRequest(
                "Someone", "9123456789", "123 Main St", Lat, Lng, "", items)),
        };
        request.AttachCsrf(csrf);
        var response = await client.SendAsync(request);
        response.StatusCode.ShouldBe(HttpStatusCode.OK);
        return (await response.Content.ReadFromJsonAsync<OrderResponse>())!;
    }

    private HttpRequestMessage EditRequest(string orderId, string csrf, List<OrderItemDto> items)
    {
        var request = new HttpRequestMessage(HttpMethod.Put, $"/api/orders/my/{orderId}")
        {
            Content = JsonContent.Create(new UpdateMyOrderRequest(
                "Someone", "9123456789", "123 Main St", Lat, Lng, "", items)),
        };
        request.AttachCsrf(csrf);
        return request;
    }

    // ---------- somebody else's order ----------

    [Fact]
    public async Task EditingSomebodyElsesOrder_IsRefused()
    {
        await SetUpAsync();
        var victimOrder = await PlaceAsync(_victim, _victimCsrf, Items(6));

        var response = await _attacker.SendAsync(EditRequest(victimOrder.Id, _attackerCsrf, Items(60)));

        response.StatusCode.ShouldBe(HttpStatusCode.Forbidden);
    }

    [Fact]
    public async Task CancellingSomebodyElsesOrder_IsRefused()
    {
        await SetUpAsync();
        var victimOrder = await PlaceAsync(_victim, _victimCsrf, Items(6));

        var request = new HttpRequestMessage(
            HttpMethod.Patch, $"/api/orders/my/{victimOrder.Id}/cancel")
        {
            Content = JsonContent.Create(new CancelOrderRequest(RefundDestinations.Wallet)),
        };
        request.AttachCsrf(_attackerCsrf);
        var response = await _attacker.SendAsync(request);

        response.StatusCode.ShouldBe(HttpStatusCode.Forbidden);

        var stillLive = (await _victim.GetFromJsonAsync<List<OrderResponse>>("/api/orders/my"))!
            .Single(o => o.Id == victimOrder.Id);
        stillLive.Status.ShouldNotBe("Cancelled");
    }

    [Fact]
    public async Task AskingForSomebodyElsesPaymentStatus_IsRefused()
    {
        await SetUpAsync();
        var victimOrder = await PlaceAsync(_victim, _victimCsrf, Items(6));

        var response = await _attacker.GetAsync($"/api/payments/cashfree/status/{victimOrder.Id}");

        response.StatusCode.ShouldBe(HttpStatusCode.Forbidden);
    }

    [Fact]
    public async Task DiscardingSomebodyElsesPendingChanges_IsRefused()
    {
        await SetUpAsync();
        var victimOrder = await PlaceAsync(_victim, _victimCsrf, Items(6));

        var request = new HttpRequestMessage(
            HttpMethod.Delete, $"/api/orders/my/{victimOrder.Id}/amendment");
        request.AttachCsrf(_attackerCsrf);

        (await _attacker.SendAsync(request)).StatusCode.ShouldBe(HttpStatusCode.Forbidden);
    }

    /// <summary>
    /// `retryOfOrderId` names an order to retire from the customer's list. Left unchecked it
    /// would be a way to make somebody else's order — or a live one of your own — disappear.
    /// </summary>
    [Fact]
    public async Task NamingSomebodyElsesOrderAsARetry_DoesNotHideIt()
    {
        await SetUpAsync();
        var victimOrder = await PlaceAsync(_victim, _victimCsrf, Items(6));

        var request = new HttpRequestMessage(HttpMethod.Post, "/api/orders")
        {
            Content = JsonContent.Create(new PlaceOrderRequest(
                "Attacker", "9123456789", "123 Main St", Lat, Lng, "", Items(1),
                CouponCode: null, UseWallet: true, RetryOfOrderId: victimOrder.Id)),
        };
        request.AttachCsrf(_attackerCsrf);
        (await _attacker.SendAsync(request)).StatusCode.ShouldBe(HttpStatusCode.OK);

        var stillThere = await _victim.GetFromJsonAsync<List<OrderResponse>>("/api/orders/my");
        stillThere!.Select(o => o.Id).ShouldContain(victimOrder.Id);
    }

    [Fact]
    public async Task NamingYourOwnLiveOrderAsARetry_DoesNotHideIt()
    {
        await SetUpAsync();
        var live = await PlaceAsync(_attacker, _attackerCsrf, Items(6));

        var request = new HttpRequestMessage(HttpMethod.Post, "/api/orders")
        {
            Content = JsonContent.Create(new PlaceOrderRequest(
                "Attacker", "9123456789", "123 Main St", Lat, Lng, "", Items(1),
                CouponCode: null, UseWallet: true, RetryOfOrderId: live.Id)),
        };
        request.AttachCsrf(_attackerCsrf);
        (await _attacker.SendAsync(request)).StatusCode.ShouldBe(HttpStatusCode.OK);

        var mine = await _attacker.GetFromJsonAsync<List<OrderResponse>>("/api/orders/my");
        mine!.Select(o => o.Id).ShouldContain(live.Id);
    }

    // ---------- numbers the browser makes up ----------

    [Fact]
    public async Task AZeroOrNegativeQuantity_IsRefused()
    {
        await SetUpAsync();

        foreach (var quantity in new[] { 0, -5 })
        {
            var request = new HttpRequestMessage(HttpMethod.Post, "/api/orders")
            {
                Content = JsonContent.Create(new PlaceOrderRequest(
                    "Attacker", "9123456789", "123 Main St", Lat, Lng, "", Items(quantity))),
            };
            request.AttachCsrf(_attackerCsrf);
            (await _attacker.SendAsync(request)).StatusCode.ShouldBe(HttpStatusCode.BadRequest);
        }
    }

    /// <summary>A negative quantity on one line would otherwise subtract from the total, which is
    /// the cheapest possible way to pay less than the goods cost.</summary>
    [Fact]
    public async Task ANegativeQuantityHiddenAmongValidLines_CannotReduceTheTotal()
    {
        await SetUpAsync();
        var second = await _factory.SeedProductAsync(price: 500m, name: "Expensive");

        var request = new HttpRequestMessage(HttpMethod.Post, "/api/orders")
        {
            Content = JsonContent.Create(new PlaceOrderRequest(
                "Attacker", "9123456789", "123 Main St", Lat, Lng, "",
                [
                    new(second.Id!, second.Name, 500m, second.Weight, 1),
                    new(_product.Id!, _product.Name, 100m, _product.Weight, -4),
                ])),
        };
        request.AttachCsrf(_attackerCsrf);

        (await _attacker.SendAsync(request)).StatusCode.ShouldBe(HttpStatusCode.BadRequest);
    }

    [Fact]
    public async Task AnInventedCouponCode_BuysNoDiscount()
    {
        await SetUpAsync();

        var request = new HttpRequestMessage(HttpMethod.Post, "/api/orders")
        {
            Content = JsonContent.Create(new PlaceOrderRequest(
                "Attacker", "9123456789", "123 Main St", Lat, Lng, "", Items(6),
                CouponCode: "SAVE99")),
        };
        request.AttachCsrf(_attackerCsrf);
        var order = (await (await _attacker.SendAsync(request))
            .Content.ReadFromJsonAsync<OrderResponse>())!;

        order.DiscountAmount.ShouldBe(0m);
        order.CouponCode.ShouldBeNull();
        order.TotalAmount.ShouldBe(600m);
    }

    /// <summary>A real code, but on a cart that doesn't clear its minimum.</summary>
    [Fact]
    public async Task ARealCouponBelowItsMinimum_BuysNoDiscount()
    {
        await SetUpAsync();

        var request = new HttpRequestMessage(HttpMethod.Post, "/api/orders")
        {
            Content = JsonContent.Create(new PlaceOrderRequest(
                "Attacker", "9123456789", "123 Main St", Lat, Lng, "", Items(6),
                CouponCode: "SAVE10")), // needs a 2000 cart, this is 600
        };
        request.AttachCsrf(_attackerCsrf);
        var order = (await (await _attacker.SendAsync(request))
            .Content.ReadFromJsonAsync<OrderResponse>())!;

        order.DiscountAmount.ShouldBe(0m);
        order.TotalAmount.ShouldBe(600m);
    }

    [Fact]
    public async Task AnAbsurdQuantity_IsRefusedRatherThanOrdered()
    {
        await SetUpAsync();

        var request = new HttpRequestMessage(HttpMethod.Post, "/api/orders")
        {
            Content = JsonContent.Create(new PlaceOrderRequest(
                "Attacker", "9123456789", "123 Main St", Lat, Lng, "", Items(1_000_000))),
        };
        request.AttachCsrf(_attackerCsrf);

        (await _attacker.SendAsync(request)).StatusCode.ShouldBe(HttpStatusCode.BadRequest);
    }

    /// <summary>Free-text fields are bounded, so an order document can't be inflated towards
    /// MongoDB's per-document limit by one request.</summary>
    [Fact]
    public async Task AMegabyteOfNotes_IsRefused()
    {
        await SetUpAsync();

        var request = new HttpRequestMessage(HttpMethod.Post, "/api/orders")
        {
            Content = JsonContent.Create(new PlaceOrderRequest(
                "Attacker", "9123456789", "123 Main St", Lat, Lng,
                new string('x', 1_000_000), Items(1))),
        };
        request.AttachCsrf(_attackerCsrf);

        (await _attacker.SendAsync(request)).StatusCode.ShouldBe(HttpStatusCode.BadRequest);
    }

    // ---------- the shelf ----------

    /// <summary>Two customers racing for the last packet: one gets it, the other is told, and the
    /// shelf never goes negative.</summary>
    [Fact]
    public async Task TwoCustomersRacingForTheLastStock_CannotBothWin()
    {
        await SetUpAsync();
        var scarce = await _factory.SeedProductAsync(price: 100m, stock: 1, name: "Last One");
        var line = new List<OrderItemDto>
        {
            new(scarce.Id!, scarce.Name, scarce.Price, scarce.Weight, 1),
        };

        var first = PlaceRawAsync(_victim, _victimCsrf, line);
        var second = PlaceRawAsync(_attacker, _attackerCsrf, line);
        await Task.WhenAll(first, second);

        var won = new[] { first.Result, second.Result }.Count(r => r.StatusCode == HttpStatusCode.OK);
        won.ShouldBe(1);

        int? stock = null;
        await _factory.SeedAsync(async db =>
            stock = (await db.Products.Find(p => p.Id == scarce.Id).FirstOrDefaultAsync())?.StockQuantity);
        stock.ShouldBe(0);
    }

    private async Task<HttpResponseMessage> PlaceRawAsync(
        HttpClient client, string csrf, List<OrderItemDto> items)
    {
        var request = new HttpRequestMessage(HttpMethod.Post, "/api/orders")
        {
            Content = JsonContent.Create(new PlaceOrderRequest(
                "Someone", "9123456789", "123 Main St", Lat, Lng, "", items)),
        };
        request.AttachCsrf(csrf);
        return await client.SendAsync(request);
    }
}
