using System.Net;
using System.Net.Http.Json;
using MongoDB.Driver;
using OjasApi.Models;
using Shouldly;

namespace OjasApi.Tests.Integration;

/// <summary>
/// What an edit may do, and what it costs. An edit only ever <em>adds</em> — taking things off a
/// placed order is refused, because that was the single path by which an edit could owe money
/// back, and it dragged refunds, wallet credits and stock returns into what is otherwise one-way.
/// Everything else is still re-run from scratch on every edit: prices come from the catalog and
/// never from the request, the coupon is re-validated, delivery is re-evaluated against the new
/// subtotal, and any increase is collected online before it takes effect.
/// </summary>
[Collection(MongoCollectionFixture.Name)]
public class OrderRepricingTests : IDisposable
{
    private readonly OjasApiFactory _factory;
    private readonly HttpClient _client;

    public OrderRepricingTests(MongoRunnerFixture mongo)
    {
        _factory = new OjasApiFactory(mongo);
        _client = _factory.CreateClient();
    }

    public void Dispose()
    {
        _client.Dispose();
        _factory.Dispose();
    }

    // Delivery sits ~1.1km from the warehouse with no free-distance allowance, so there is always
    // a small distance-based charge available to be waived. That makes the free-delivery *cart*
    // threshold - what these tests are actually about - the only thing that zeroes it.
    private const double WarehouseLat = 18.0;
    private const double Lng = 73.0;
    private const double Lat = 18.01;

    private async Task SeedDeliveryChargesAsync()
    {
        await _factory.SeedAsync(async db => await db.DeliveryCharges.InsertOneAsync(new DeliveryCharges
        {
            WarehouseAddress = "Test Warehouse",
            WarehouseLatitude = WarehouseLat,
            WarehouseLongitude = Lng,
            FreeDeliveryUpToKm = 0,
            PerKmChargeAfterFree = 10,
            IsActive = true,
        }));

        _product = await _factory.SeedProductAsync(price: 100m);
    }

    /// <summary>The catalog product these tests order. Orders are priced server-side from the
    /// catalog, so it has to be a real one — the price passed here is ignored by the API and only
    /// kept so the request looks like a browser's.</summary>
    private Product _product = null!;

    private List<OrderItemDto> Items(int quantity, decimal price = 100m) =>
        [new(_product.Id!, _product.Name, price, _product.Weight, quantity)];

    private async Task<(OrderResponse Order, string Csrf)> PlaceOrderAsync(
        List<OrderItemDto> items, string? couponCode = null)
    {
        var (_, csrf) = await _client.RegisterAsync(fullName: "Repricing Customer");
        var request = new PlaceOrderRequest(
            "Repricing Customer", "9123456789", "123 Main St", Lat, Lng, "", items, couponCode);
        var httpRequest = new HttpRequestMessage(HttpMethod.Post, "/api/orders") { Content = JsonContent.Create(request) };
        httpRequest.AttachCsrf(csrf);

        var response = await _client.SendAsync(httpRequest);
        response.StatusCode.ShouldBe(HttpStatusCode.OK);
        return ((await response.Content.ReadFromJsonAsync<OrderResponse>())!, csrf);
    }

    private async Task<UpdateMyOrderResponse> EditOrderAsync(
        string orderId, string csrf, List<OrderItemDto> items, string? couponCode = null)
    {
        var request = new UpdateMyOrderRequest(
            "Repricing Customer", "9123456789", "123 Main St", Lat, Lng, "", items, couponCode);
        var httpRequest = new HttpRequestMessage(HttpMethod.Put, $"/api/orders/my/{orderId}")
        {
            Content = JsonContent.Create(request),
        };
        httpRequest.AttachCsrf(csrf);

        var response = await _client.SendAsync(httpRequest);
        response.StatusCode.ShouldBe(HttpStatusCode.OK);
        return (await response.Content.ReadFromJsonAsync<UpdateMyOrderResponse>())!;
    }

    private async Task<HttpResponseMessage> EditOrderRawAsync(
        string orderId, string csrf, List<OrderItemDto> items, string? couponCode = null)
    {
        var request = new UpdateMyOrderRequest(
            "Repricing Customer", "9123456789", "123 Main St", Lat, Lng, "", items, couponCode);
        var httpRequest = new HttpRequestMessage(HttpMethod.Put, $"/api/orders/my/{orderId}")
        {
            Content = JsonContent.Create(request),
        };
        httpRequest.AttachCsrf(csrf);
        return await _client.SendAsync(httpRequest);
    }

    private async Task<WalletResponse> GetWalletAsync() =>
        (await _client.GetFromJsonAsync<WalletResponse>("/api/wallet"))!;

    /// <summary>Simulates the customer having actually paid, which the gateway would otherwise
    /// report asynchronously - the top-up and refund rules only apply once money is captured.
    /// Records a real payment rather than setting the paid figure directly, because that figure
    /// is derived from recorded payments and would simply be recomputed away.</summary>
    private async Task MarkPaidAsync(string orderId, decimal amountPaid)
    {
        await _factory.SeedAsync(async db => await db.Orders.UpdateOneAsync(
            o => o.Id == orderId,
            Builders<Order>.Update
                .Push(o => o.Payments, new OrderPayment
                {
                    CfPaymentId = $"cf_pay_{Guid.NewGuid():N}",
                    Amount = amountPaid,
                    Instrument = "upi",
                })
                .Set(o => o.AmountPaid, amountPaid)
                .Set(o => o.PaymentStatus, "Paid")));
    }

    // ---------- the catalog, not the browser, decides what things cost ----------

    /// <summary>
    /// The prices in the request are ignored outright. They used to be totalled as sent, so a
    /// crafted POST could buy a ₹600 order for ₹6 — the business simply lost the difference.
    /// </summary>
    [Fact]
    public async Task PricesSentByTheBrowser_AreIgnoredInFavourOfTheCatalog()
    {
        await SeedDeliveryChargesAsync();

        // A browser claiming these cost ₹1 each rather than the catalog's ₹100.
        var tampered = new List<OrderItemDto>
        {
            new(_product.Id!, _product.Name, 1m, _product.Weight, 6),
        };

        var (order, _) = await PlaceOrderAsync(tampered);

        order.TotalAmount.ShouldBe(600m);
        order.Items.ShouldHaveSingleItem().Price.ShouldBe(100m);
    }

    [Fact]
    public async Task EditingAnOrder_AlsoIgnoresPricesSentByTheBrowser()
    {
        await SeedDeliveryChargesAsync();
        var (order, csrf) = await PlaceOrderAsync(Items(6));

        var tampered = new List<OrderItemDto>
        {
            new(_product.Id!, _product.Name, 1m, _product.Weight, 8),
        };
        var result = await EditOrderAsync(order.Id, csrf, tampered);

        result.Order.TotalAmount.ShouldBe(800m);
    }

    /// <summary>
    /// The discount advertised against a product is what the customer is charged. It used to be
    /// display-only: the storefront showed "20% OFF" and a sale price while the order was billed
    /// at the full list price.
    /// </summary>
    [Fact]
    public async Task ADiscountedProduct_IsChargedAtItsDiscountedPrice()
    {
        await SeedDeliveryChargesAsync();
        _product = await _factory.SeedProductAsync(price: 200m, discount: 25m, name: "On Offer");

        var (order, _) = await PlaceOrderAsync(Items(4));

        // 200 less 25% = 150 each.
        order.Items.ShouldHaveSingleItem().Price.ShouldBe(150m);
        order.TotalAmount.ShouldBe(600m);
    }

    /// <summary>An order already placed keeps the price it agreed. Re-pricing existing lines from
    /// a catalog that has moved since would bill the customer again for goods they already
    /// bought, purely because they changed the quantity of something else.</summary>
    [Fact]
    public async Task EditingAnOrder_KeepsThePriceItWasPlacedAt_EvenIfTheCatalogHasMovedSince()
    {
        await SeedDeliveryChargesAsync();
        var (order, csrf) = await PlaceOrderAsync(Items(6)); // 6 x 100 = 600

        await _factory.SeedAsync(async db => await db.Products.UpdateOneAsync(
            p => p.Id == _product.Id,
            Builders<Product>.Update.Set(p => p.Price, 500m)));

        var result = await EditOrderAsync(order.Id, csrf, Items(7));

        result.Order.Items.ShouldHaveSingleItem().Price.ShouldBe(100m);
        result.Order.TotalAmount.ShouldBe(700m);
    }

    /// <summary>
    /// The same product sent as several separate lines. Nothing stops a crafted request doing
    /// this, and the order used to store it verbatim — which then made the order un-editable,
    /// because pricing an edit keys the existing lines by product id and a duplicate key throws.
    /// One line per product, quantities added up.
    /// </summary>
    [Fact]
    public async Task TheSameProductSentAsSeveralLines_BecomesOneLine()
    {
        await SeedDeliveryChargesAsync();

        var (order, csrf) = await PlaceOrderAsync([
            new(_product.Id!, _product.Name, 100m, _product.Weight, 2),
            new(_product.Id!, _product.Name, 100m, _product.Weight, 3),
            new(_product.Id!, _product.Name, 100m, _product.Weight, 1),
        ]);

        order.Items.ShouldHaveSingleItem().Quantity.ShouldBe(6);
        order.TotalAmount.ShouldBe(600m);

        // And it can still be edited afterwards, which a duplicated line made impossible.
        var edited = await EditOrderAsync(order.Id, csrf, Items(8));
        edited.Order.ShouldNotBeNull();
    }

    [Fact]
    public async Task OrderingAProductThatIsNotInTheCatalog_IsRefused()
    {
        await SeedDeliveryChargesAsync();
        var (_, csrf) = await _client.RegisterAsync(fullName: "Repricing Customer");

        var request = new PlaceOrderRequest(
            "Repricing Customer", "9123456789", "123 Main St", Lat, Lng, "",
            [new("507f1f77bcf86cd799439099", "Ghost Product", 100m, "1kg", 1)]);
        var httpRequest = new HttpRequestMessage(HttpMethod.Post, "/api/orders")
        {
            Content = JsonContent.Create(request),
        };
        httpRequest.AttachCsrf(csrf);

        var response = await _client.SendAsync(httpRequest);

        response.StatusCode.ShouldBe(HttpStatusCode.BadRequest);
    }

    [Fact]
    public async Task EditKeepsAnAppliedCoupon_RatherThanSilentlyDroppingIt()
    {
        await SeedDeliveryChargesAsync();
        // 12 x 100 = 1200, clears SAVE5's 1000 minimum.
        var (order, csrf) = await PlaceOrderAsync(Items(12), "SAVE5");
        order.CouponCode.ShouldBe("SAVE5");

        // The edit doesn't resend the code - the server must fall back to the order's own.
        var result = await EditOrderAsync(order.Id, csrf, Items(13));

        result.Order.CouponCode.ShouldBe("SAVE5");
        result.Order.DiscountAmount.ShouldBe(65m); // 5% of 1300
        result.RemovedCouponCode.ShouldBeNull();
    }

    // ---------- an edit may only add ----------

    /// <summary>
    /// Taking something off an order that has already been placed is refused outright. It was the
    /// one path by which an edit could owe money *back*, which pulled refunds, wallet credits and
    /// stock returns into what is otherwise a one-way flow. A customer who no longer wants the
    /// order cancels it, which has always been the honest way out.
    /// </summary>
    [Fact]
    public async Task RemovingALineFromAPlacedOrder_IsRefused()
    {
        await SeedDeliveryChargesAsync();
        var (order, csrf) = await PlaceOrderAsync(Items(6));

        var response = await EditOrderRawAsync(order.Id, csrf, []);

        response.StatusCode.ShouldBe(HttpStatusCode.BadRequest);
        // Untouched: a refused edit changes nothing at all.
        var unchanged = (await _client.GetFromJsonAsync<List<OrderResponse>>("/api/orders/my"))!
            .Single(o => o.Id == order.Id);
        unchanged.Items.Single().Quantity.ShouldBe(6);
        unchanged.TotalAmount.ShouldBe(order.TotalAmount);
    }

    [Fact]
    public async Task ReducingAQuantityOnAPlacedOrder_IsRefused()
    {
        await SeedDeliveryChargesAsync();
        var (order, csrf) = await PlaceOrderAsync(Items(6));

        var response = await EditOrderRawAsync(order.Id, csrf, Items(4));

        response.StatusCode.ShouldBe(HttpStatusCode.BadRequest);
        (await _client.GetFromJsonAsync<List<OrderResponse>>("/api/orders/my"))!
            .Single(o => o.Id == order.Id).Items.Single().Quantity.ShouldBe(6);
    }

    /// <summary>The rule is enforced by the endpoint, not by hiding the minus button - a request
    /// that never went near the UI is refused just the same.</summary>
    [Fact]
    public async Task DroppingOneLineWhileAddingAnother_IsStillRefused()
    {
        await SeedDeliveryChargesAsync();
        var second = await _factory.SeedProductAsync(price: 50m, name: "Product Two");
        var (order, csrf) = await PlaceOrderAsync(Items(6));

        // Swaps the ordered product out for a different one, which is a removal in disguise.
        var response = await EditOrderRawAsync(order.Id, csrf,
            [new(second.Id!, second.Name, second.Price, second.Weight, 12)]);

        response.StatusCode.ShouldBe(HttpStatusCode.BadRequest);
    }

    /// <summary>Adding can only ever make a coupon more applicable, never less - so the discount
    /// the customer already had survives, and a bigger tier can even come into reach.</summary>
    [Fact]
    public async Task AddingItems_KeepsTheCouponAndCanReachABiggerTier()
    {
        await SeedDeliveryChargesAsync();
        var (order, csrf) = await PlaceOrderAsync(Items(12), "SAVE5"); // 1200
        order.DiscountAmount.ShouldBe(60m);

        // Up to 2100, which clears SAVE10's minimum.
        var result = await EditOrderAsync(order.Id, csrf, Items(21), "SAVE10");

        result.RemovedCouponCode.ShouldBeNull();
        result.Order.PendingAmendment.ShouldBeNull(); // Nothing was paid, so nothing is staged.
        result.Order.CouponCode.ShouldBe("SAVE10");
        result.Order.DiscountAmount.ShouldBe(210m);
    }

    [Fact]
    public async Task EditAboveTheFreeDeliveryThreshold_StopsCharging()
    {
        await SeedDeliveryChargesAsync();
        var (order, csrf) = await PlaceOrderAsync(Items(4)); // 400
        order.DeliveryCharge.ShouldBeGreaterThan(0m);

        var result = await EditOrderAsync(order.Id, csrf, Items(6)); // 600

        result.Order.DeliveryCharge.ShouldBe(0m);
        result.Order.TotalAmount.ShouldBe(600m);
    }

    [Fact]
    public async Task RaisingThePaidTotal_ChargesOnlyTheDifferenceOnline()
    {
        await SeedDeliveryChargesAsync();
        var (order, csrf) = await PlaceOrderAsync(Items(6)); // 600, free delivery
        await MarkPaidAsync(order.Id, 600m);

        var result = await EditOrderAsync(order.Id, csrf, Items(8)); // 800

        // The delta, not the whole new total - a Cashfree order's amount can't be amended, so
        // the top-up is its own payment.
        result.TopUpAmount.ShouldBe(200m);
        result.PaymentSessionId.ShouldNotBeNullOrWhiteSpace();
        result.RefundAmount.ShouldBeNull();

        // The changes are only a proposal until the difference is paid: the order still describes
        // what the customer actually bought, and is not left looking underpaid for goods they
        // never agreed to buy.
        result.PendingPayment.ShouldBeTrue();
        result.Order.TotalAmount.ShouldBe(600m);
        result.Order.Items.Single().Quantity.ShouldBe(6);
        result.Order.PaymentStatus.ShouldBe("Paid");
        result.Order.AmountPaid.ShouldBe(600m);

        // ...and what it would become is reported alongside, so the customer can see it and pay.
        var amendment = result.Order.PendingAmendment.ShouldNotBeNull();
        amendment.TotalAmount.ShouldBe(800m);
        amendment.TopUpAmount.ShouldBe(200m);
        amendment.Items.Single().Quantity.ShouldBe(8);
    }

    [Fact]
    public async Task EditingAnUnpaidOrder_NeitherTopsUpNorRefunds()
    {
        await SeedDeliveryChargesAsync();
        var (order, csrf) = await PlaceOrderAsync(Items(6));

        // Nothing was ever captured, so the whole (revised) total is still simply outstanding.
        var result = await EditOrderAsync(order.Id, csrf, Items(9));

        result.TopUpAmount.ShouldBeNull();
        result.RefundAmount.ShouldBeNull();
    }
}
