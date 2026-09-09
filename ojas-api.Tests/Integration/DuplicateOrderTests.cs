using System.Net;
using System.Net.Http.Json;
using MongoDB.Driver;
using OjasApi.Models;
using Shouldly;

namespace OjasApi.Tests.Integration;

/// <summary>
/// One basket, one order - however many times the browser asks.
///
/// Every guard against a customer placing the same basket twice used to live in the browser: a
/// disabled button, a sessionStorage marker, a redirect away from checkout. All of them are
/// defeated by ordinary things - pressing Pay again while the checkout SDK loads, a tab the
/// browser rebuilt, a cleared session store, pressing "Try payment again" twice - and each one
/// placed a second order, took stock for it again, and left the customer with two live orders for
/// one basket. These are the server-side tests that stop that happening.
/// </summary>
[Collection(MongoCollectionFixture.Name)]
public class DuplicateOrderTests : IDisposable
{
    private readonly OjasApiFactory _factory;
    private readonly HttpClient _client;
    private string _csrf = string.Empty;
    private Product _product = null!;

    public DuplicateOrderTests(MongoRunnerFixture mongo)
    {
        _factory = new OjasApiFactory(mongo);
        _client = _factory.CreateClient();
    }

    public void Dispose()
    {
        _client.Dispose();
        _factory.Dispose();
    }

    private const double Lat = 18.0;
    private const double Lng = 73.0;

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
        var (_, csrf) = await _client.RegisterAsync(fullName: "Repeat Customer");
        _csrf = csrf;
        _product = await _factory.SeedProductAsync(price: 100m);
    }

    private List<OrderItemDto> Items(int quantity) =>
        [new(_product.Id!, _product.Name, 100m, _product.Weight, quantity)];

    private async Task<HttpResponseMessage> PostOrderAsync(
        List<OrderItemDto> items, string? retryOf = null, string address = "123 Main St")
    {
        var request = new HttpRequestMessage(HttpMethod.Post, "/api/orders")
        {
            Content = JsonContent.Create(new PlaceOrderRequest(
                "Repeat Customer", "9123456789", address, Lat, Lng, "", items,
                CouponCode: null, UseWallet: true, RetryOfOrderId: retryOf)),
        };
        request.AttachCsrf(_csrf);
        return await _client.SendAsync(request);
    }

    private async Task<OrderResponse> PlaceAsync(
        List<OrderItemDto>? items = null, string? retryOf = null, string address = "123 Main St")
    {
        var response = await PostOrderAsync(items ?? Items(2), retryOf, address);
        response.StatusCode.ShouldBe(HttpStatusCode.OK);
        return (await response.Content.ReadFromJsonAsync<OrderResponse>())!;
    }

    private async Task<List<OrderResponse>> MyOrdersAsync() =>
        (await _client.GetFromJsonAsync<List<OrderResponse>>("/api/orders/my"))!;

    private async Task<int> OrdersInDatabaseAsync()
    {
        var count = 0;
        await _factory.SeedAsync(async db =>
            count = (int)await db.Orders.CountDocumentsAsync(Builders<Order>.Filter.Empty));
        return count;
    }

    private async Task<string> CheckPaymentStatusAsync(string orderId)
    {
        var response = await _client.GetAsync($"/api/payments/cashfree/status/{orderId}");
        response.StatusCode.ShouldBe(HttpStatusCode.OK);
        return (await response.Content.ReadFromJsonAsync<CashfreePaymentStatusResponse>())!.PaymentStatus;
    }

    /// <summary>The plainest form of the bug: the customer presses Pay, nothing visibly happens
    /// while the checkout SDK loads, and they press it again.</summary>
    [Fact]
    public async Task PlacingTheSameBasketTwice_ResumesTheFirstOrderInsteadOfMintingASecond()
    {
        await SetUpAsync();

        var first = await PlaceAsync();
        var second = await PlaceAsync();

        second.Id.ShouldBe(first.Id);
        (await MyOrdersAsync()).Count.ShouldBe(1);
        (await OrdersInDatabaseAsync()).ShouldBe(1);
    }

    /// <summary>And the payment page it opens is the one already raised, not a second gateway
    /// order sitting alongside the first - two live payment links for one order is how a customer
    /// manages to pay for the same thing twice.</summary>
    [Fact]
    public async Task PlacingTheSameBasketTwice_HandsBackTheSessionAlreadyRaised()
    {
        await SetUpAsync();

        var first = await PlaceAsync();
        var second = await PlaceAsync();

        second.PaymentSessionId.ShouldNotBeNullOrWhiteSpace();
        second.PaymentSessionId.ShouldBe(first.PaymentSessionId);
        _factory.Cashfree.CreatedOrderIds.Count.ShouldBe(1);
    }

    /// <summary>Stock is the part that made a duplicate expensive rather than merely untidy: a
    /// second order for the same basket took the goods off the shelf all over again.</summary>
    [Fact]
    public async Task PlacingTheSameBasketTwice_TakesStockOnlyOnce()
    {
        await SetUpAsync();
        var tracked = new Product
        {
            Name = "Tracked Product",
            Description = "",
            Price = 100m,
            Category = "Flour",
            Weight = "1kg",
            StockQuantity = 10,
        };
        await _factory.SeedAsync(async db => await db.Products.InsertOneAsync(tracked));
        var items = new List<OrderItemDto> { new(tracked.Id!, tracked.Name, 100m, "1kg", 3) };

        await PlaceAsync(items);
        await PlaceAsync(items);

        int? remaining = null;
        await _factory.SeedAsync(async db =>
            remaining = (await db.Products.Find(p => p.Id == tracked.Id).FirstOrDefaultAsync())?.StockQuantity);
        remaining.ShouldBe(7);
    }

    /// <summary>"Try payment again", pressed twice. The second press names the same dead order as
    /// the first, and used to place a third order beside the replacement rather than landing on
    /// it - which is what left two live orders behind every retry.</summary>
    [Fact]
    public async Task RetryingTheSameFailedOrderTwice_LandsOnTheReplacementItAlreadyHas()
    {
        await SetUpAsync();
        var failed = await PlaceAsync();

        _factory.Cashfree.FailAllOutstanding();
        (await CheckPaymentStatusAsync(failed.Id)).ShouldBe("Failed");

        var firstRetry = await PlaceAsync(retryOf: failed.Id);
        var secondRetry = await PlaceAsync(retryOf: failed.Id);

        secondRetry.Id.ShouldBe(firstRetry.Id);
        firstRetry.Id.ShouldNotBe(failed.Id);

        var mine = await MyOrdersAsync();
        mine.Count.ShouldBe(1);
        mine.Single().Id.ShouldBe(firstRetry.Id);
    }

    /// <summary>A payment the bank has not finished deciding on must block a repeat placement
    /// outright. Handing back a payment page there is how a customer pays twice for one basket.</summary>
    [Fact]
    public async Task PlacingAgainWhileAPaymentIsWithTheBank_IsRefusedRatherThanDuplicated()
    {
        await SetUpAsync();
        var first = await PlaceAsync();

        _factory.Cashfree.LeaveAllOutstandingPending();

        var response = await PostOrderAsync(Items(2));
        response.StatusCode.ShouldBe(HttpStatusCode.Conflict);
        (await response.Content.ReadAsStringAsync()).ShouldContain(first.Id);
        (await OrdersInDatabaseAsync()).ShouldBe(1);
    }

    /// <summary>Placing the same basket again after it has actually been paid for is a second
    /// purchase, not a duplicate, and must go through.</summary>
    [Fact]
    public async Task ReorderingAfterThePreviousOneIsPaid_PlacesAGenuineSecondOrder()
    {
        await SetUpAsync();
        var first = await PlaceAsync();

        _factory.Cashfree.PayAllOutstanding();
        (await CheckPaymentStatusAsync(first.Id)).ShouldBe("Paid");

        var second = await PlaceAsync();

        second.Id.ShouldNotBe(first.Id);
        (await MyOrdersAsync()).Count.ShouldBe(2);
    }

    /// <summary>A different basket is a different order, however soon it follows.</summary>
    [Fact]
    public async Task PlacingADifferentBasket_IsNotTreatedAsADuplicate()
    {
        await SetUpAsync();
        var first = await PlaceAsync(Items(2));
        var second = await PlaceAsync(Items(5));

        second.Id.ShouldNotBe(first.Id);
        (await MyOrdersAsync()).Count.ShouldBe(2);
    }

    /// <summary>Same items, different delivery address - the customer meant a second order.</summary>
    [Fact]
    public async Task PlacingTheSameItemsToADifferentAddress_IsNotTreatedAsADuplicate()
    {
        await SetUpAsync();
        var first = await PlaceAsync(address: "123 Main St");
        var second = await PlaceAsync(address: "456 Other Rd");

        second.Id.ShouldNotBe(first.Id);
        (await MyOrdersAsync()).Count.ShouldBe(2);
    }

    /// <summary>Two placements sent at once - two tabs, or a request the browser repeated - both
    /// pass the duplicate check before either has inserted. Whichever lands second has to stand
    /// itself down rather than leaving a second live order behind it.</summary>
    [Fact]
    public async Task TwoPlacementsSentAtOnce_StillLeaveOnlyOneLiveOrder()
    {
        await SetUpAsync();

        var both = await Task.WhenAll(PostOrderAsync(Items(2)), PostOrderAsync(Items(2)));

        foreach (var response in both)
            response.StatusCode.ShouldBeOneOf(HttpStatusCode.OK, HttpStatusCode.Conflict);

        var mine = await MyOrdersAsync();
        mine.Count.ShouldBe(1);
        mine.Single().Status.ShouldBe("Pending");
    }

    /// <summary>A repeat placement that finds the money already landed reports the order as paid
    /// rather than asking for it again - the customer closed the tab mid-payment and came back.</summary>
    [Fact]
    public async Task PlacingAgainAfterThePaymentQuietlySucceeded_ReportsThatOrderAsPaid()
    {
        await SetUpAsync();
        var first = await PlaceAsync();

        _factory.Cashfree.PayAllOutstanding();

        var second = await PlaceAsync();
        second.Id.ShouldBe(first.Id);
        second.PaymentStatus.ShouldBe("Paid");
        second.PaymentSessionId.ShouldBeNull();
        (await OrdersInDatabaseAsync()).ShouldBe(1);
    }
}
