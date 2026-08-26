using System.Net;
using System.Net.Http.Json;
using MongoDB.Driver;
using OjasApi.Models;
using Shouldly;

namespace OjasApi.Tests.Integration;

/// <summary>
/// The whole life of an order's money: pay, edit it upward, pay the resulting top-up, edit it
/// back down. This sequence is what exposed a real bug — a top-up is charged as its own gateway
/// order, so anything that asked the gateway only about the *original* order never saw it, left
/// the order looking underpaid, and then demanded more money from a customer who had already
/// paid. Testing only the first payment hides every one of these.
/// </summary>
[Collection(MongoCollectionFixture.Name)]
public class PaymentLifecycleTests : IDisposable
{
    private readonly OjasApiFactory _factory;
    private readonly HttpClient _client;
    private string _csrf = string.Empty;

    public PaymentLifecycleTests(MongoRunnerFixture mongo)
    {
        _factory = new OjasApiFactory(mongo);
        _client = _factory.CreateClient();
    }

    public void Dispose()
    {
        _client.Dispose();
        _factory.Dispose();
    }

    private const double WarehouseLat = 18.0;
    private const double Lng = 73.0;
    private const double Lat = 18.0; // Same spot: distance zero, so delivery never muddies totals.

    private async Task SetUpAsync()
    {
        await _factory.SeedAsync(async db => await db.DeliveryCharges.InsertOneAsync(new DeliveryCharges
        {
            WarehouseAddress = "Test Warehouse",
            WarehouseLatitude = WarehouseLat,
            WarehouseLongitude = Lng,
            FreeDeliveryUpToKm = 5,
            PerKmChargeAfterFree = 10,
            IsActive = true,
        }));
        var (_, csrf) = await _client.RegisterAsync(fullName: "Lifecycle Customer");
        _csrf = csrf;
        _product = await _factory.SeedProductAsync(price: 100m);
    }

    /// <summary>The catalog product these tests order. Orders are priced server-side from the
    /// catalog, so it has to be a real one — the price passed here is ignored by the API and only
    /// kept so the request looks like a browser's.</summary>
    private Product _product = null!;

    private List<OrderItemDto> Items(int quantity, decimal price = 100m) =>
        [new(_product.Id!, _product.Name, price, _product.Weight, quantity)];

    private async Task<OrderResponse> PlaceOrderAsync(List<OrderItemDto> items)
    {
        var request = new HttpRequestMessage(HttpMethod.Post, "/api/orders")
        {
            Content = JsonContent.Create(new PlaceOrderRequest(
                "Lifecycle Customer", "9123456789", "123 Main St", Lat, Lng, "", items)),
        };
        request.AttachCsrf(_csrf);
        var response = await _client.SendAsync(request);
        response.StatusCode.ShouldBe(HttpStatusCode.OK);
        return (await response.Content.ReadFromJsonAsync<OrderResponse>())!;
    }

    private async Task<UpdateMyOrderResponse> EditOrderAsync(string orderId, List<OrderItemDto> items)
    {
        var request = new HttpRequestMessage(HttpMethod.Put, $"/api/orders/my/{orderId}")
        {
            Content = JsonContent.Create(new UpdateMyOrderRequest(
                "Lifecycle Customer", "9123456789", "123 Main St", Lat, Lng, "", items)),
        };
        request.AttachCsrf(_csrf);
        var response = await _client.SendAsync(request);
        response.StatusCode.ShouldBe(HttpStatusCode.OK);
        return (await response.Content.ReadFromJsonAsync<UpdateMyOrderResponse>())!;
    }

    /// <summary>What the customer's browser does on landing back from the hosted checkout page.</summary>
    private async Task<string> CheckPaymentStatusAsync(string orderId) =>
        (await CheckPaymentAsync(orderId)).PaymentStatus;

    private async Task<CashfreePaymentStatusResponse> CheckPaymentAsync(string orderId)
    {
        var response = await _client.GetAsync($"/api/payments/cashfree/status/{orderId}");
        response.StatusCode.ShouldBe(HttpStatusCode.OK);
        return (await response.Content.ReadFromJsonAsync<CashfreePaymentStatusResponse>())!;
    }

    private async Task<OrderResponse> GetOrderAsync(string orderId)
    {
        var orders = await _client.GetFromJsonAsync<List<OrderResponse>>("/api/orders/my");
        return orders!.Single(o => o.Id == orderId);
    }

    private async Task<WalletResponse> GetWalletAsync() =>
        (await _client.GetFromJsonAsync<WalletResponse>("/api/wallet"))!;

    [Fact]
    public async Task PayingATopUp_IsActuallyCreditedToTheOrder()
    {
        await SetUpAsync();
        var order = await PlaceOrderAsync(Items(6)); // 600

        _factory.Cashfree.PayAllOutstanding();
        (await CheckPaymentStatusAsync(order.Id)).ShouldBe("Paid");

        // Add items: 900, so 300 is owed. Held as a proposal until that lands.
        var edited = await EditOrderAsync(order.Id, Items(9));
        edited.TopUpAmount.ShouldBe(300m);
        var staged = await GetOrderAsync(order.Id);
        staged.TotalAmount.ShouldBe(600m);
        staged.PendingAmendment.ShouldNotBeNull().TotalAmount.ShouldBe(900m);

        // The customer pays that top-up and lands back on the site.
        _factory.Cashfree.PayAllOutstanding();
        (await CheckPaymentStatusAsync(order.Id)).ShouldBe("Paid");

        var settled = await GetOrderAsync(order.Id);
        settled.AmountPaid.ShouldBe(900m);
        settled.TotalAmount.ShouldBe(900m);
        settled.Items.Single().Quantity.ShouldBe(9);
        settled.PendingAmendment.ShouldBeNull();
    }

    /// <summary>
    /// The browser fetches its order list the moment it lands back from checkout — before the
    /// payment has been recorded — so the confirmation has to hand back the order as it now
    /// stands. Returning only a status left the page holding a copy that still said nothing had
    /// been paid, until the customer reloaded: no delivery estimate, a cancel dialog offering to
    /// refund nothing, and an edit that priced the change against zero and asked for the whole
    /// total over again.
    /// </summary>
    [Fact]
    public async Task ConfirmingAPayment_HandsBackTheOrderWithTheMoneyOnIt()
    {
        await SetUpAsync();
        var order = await PlaceOrderAsync(Items(6)); // 600
        order.AmountPaid.ShouldBe(0m);

        _factory.Cashfree.PayAllOutstanding();
        var confirmation = await CheckPaymentAsync(order.Id);

        confirmation.PaymentStatus.ShouldBe("Paid");
        var settled = confirmation.Order.ShouldNotBeNull();
        settled.Id.ShouldBe(order.Id);
        settled.AmountPaid.ShouldBe(600m);
        settled.PaymentStatus.ShouldBe("Paid");
        settled.PaymentInstrument.ShouldBe("upi");
    }

    [Fact]
    public async Task ConfirmingAPaidTopUp_HandsBackTheAmendedOrder()
    {
        await SetUpAsync();
        var order = await PlaceOrderAsync(Items(6));
        _factory.Cashfree.PayAllOutstanding();
        await CheckPaymentStatusAsync(order.Id);

        await EditOrderAsync(order.Id, Items(9)); // 900, owes 300
        _factory.Cashfree.PayAllOutstanding();
        var confirmation = await CheckPaymentAsync(order.Id);

        // The items and total moved too, so the whole order has to come back - not just a status.
        var settled = confirmation.Order.ShouldNotBeNull();
        settled.TotalAmount.ShouldBe(900m);
        settled.AmountPaid.ShouldBe(900m);
        settled.Items.Single().Quantity.ShouldBe(9);
        settled.PendingAmendment.ShouldBeNull();
    }

    /// <summary>
    /// Having paid a top-up, the customer cannot then strip the order back down — which is what
    /// used to turn an edit into a refund. Cancelling is the way out, and that path returns the
    /// money in full.
    /// </summary>
    [Fact]
    public async Task RemovingItemsAfterPayingATopUp_IsRefused()
    {
        await SetUpAsync();
        var order = await PlaceOrderAsync(Items(6)); // 600
        _factory.Cashfree.PayAllOutstanding();
        await CheckPaymentStatusAsync(order.Id);

        await EditOrderAsync(order.Id, Items(9)); // up to 900, owes 300
        _factory.Cashfree.PayAllOutstanding();
        await CheckPaymentStatusAsync(order.Id);

        var request = new HttpRequestMessage(HttpMethod.Put, $"/api/orders/my/{order.Id}")
        {
            Content = JsonContent.Create(new UpdateMyOrderRequest(
                "Lifecycle Customer", "9123456789", "123 Main St", Lat, Lng, "", Items(7))),
        };
        request.AttachCsrf(_csrf);
        var response = await _client.SendAsync(request);

        response.StatusCode.ShouldBe(HttpStatusCode.BadRequest);

        // The paid-for order is left exactly as it was, and no money moved.
        var settled = await GetOrderAsync(order.Id);
        settled.TotalAmount.ShouldBe(900m);
        settled.AmountPaid.ShouldBe(900m);
        settled.Items.Single().Quantity.ShouldBe(9);
        (await GetWalletAsync()).Balance.ShouldBe(0m);
    }

    // ---------- a payment the bank is still deciding on ----------

    /// <summary>
    /// A top-up left pending must never be reported as a success. The order itself stays fully
    /// paid for what it currently holds, so answering with the *order's* status said "payment
    /// successful" while the changes it was for sat unapplied underneath — inviting the customer
    /// to pay a second time for the same thing.
    /// </summary>
    [Fact]
    public async Task ATopUpLeftPending_IsReportedAsPending_NotAsSuccess()
    {
        await SetUpAsync();
        var order = await PlaceOrderAsync(Items(6)); // 600
        _factory.Cashfree.PayAllOutstanding();
        await CheckPaymentStatusAsync(order.Id);

        await EditOrderAsync(order.Id, Items(9)); // owes 300
        _factory.Cashfree.LeaveAllOutstandingPending();

        var confirmation = await CheckPaymentAsync(order.Id);

        confirmation.Outcome.ShouldBe(PaymentAttemptOutcomes.Pending);
        // The order is still square for what it holds - which is exactly why its own status is
        // the wrong thing to report here.
        confirmation.PaymentStatus.ShouldBe("Paid");

        // Nothing is applied and nothing is thrown away while the bank is still deciding.
        var waiting = await GetOrderAsync(order.Id);
        waiting.TotalAmount.ShouldBe(600m);
        waiting.PendingAmendment.ShouldNotBeNull().TopUpAmount.ShouldBe(300m);
    }

    [Fact]
    public async Task APendingTopUpThatLaterSucceeds_IsAppliedNormally()
    {
        await SetUpAsync();
        var order = await PlaceOrderAsync(Items(6));
        _factory.Cashfree.PayAllOutstanding();
        await CheckPaymentStatusAsync(order.Id);

        await EditOrderAsync(order.Id, Items(9));
        _factory.Cashfree.LeaveAllOutstandingPending();
        (await CheckPaymentAsync(order.Id)).Outcome.ShouldBe(PaymentAttemptOutcomes.Pending);

        // The bank makes up its mind.
        _factory.Cashfree.SettlePending();
        var settled = await CheckPaymentAsync(order.Id);

        settled.Outcome.ShouldBe(PaymentAttemptOutcomes.Paid);
        settled.Order.ShouldNotBeNull().TotalAmount.ShouldBe(900m);
    }

    /// <summary>A first payment the bank is still deciding on must not stand the order down —
    /// that would put the goods back and cancel an order that is about to be paid for.</summary>
    [Fact]
    public async Task AFirstPaymentLeftPending_DoesNotCancelTheOrder()
    {
        await SetUpAsync();
        var order = await PlaceOrderAsync(Items(6));
        _factory.Cashfree.LeaveAllOutstandingPending();

        var confirmation = await CheckPaymentAsync(order.Id);

        confirmation.Outcome.ShouldBe(PaymentAttemptOutcomes.Pending);
        var stillLive = await GetOrderAsync(order.Id);
        stillLive.Status.ShouldNotBe("Cancelled");
        stillLive.PaymentStatus.ShouldNotBe("Failed");
    }

    /// <summary>And when the bank declines it instead, the changes are dropped rather than left
    /// hanging — the customer is told, and nothing was charged.</summary>
    [Fact]
    public async Task APendingTopUpThatLaterFails_DropsTheChangesItWasFor()
    {
        await SetUpAsync();
        var order = await PlaceOrderAsync(Items(6));
        _factory.Cashfree.PayAllOutstanding();
        await CheckPaymentStatusAsync(order.Id);

        await EditOrderAsync(order.Id, Items(9));
        _factory.Cashfree.LeaveAllOutstandingPending();
        await CheckPaymentAsync(order.Id);

        _factory.Cashfree.SettlePending(succeeded: false);
        await CheckPaymentAsync(order.Id);

        var unchanged = await GetOrderAsync(order.Id);
        unchanged.TotalAmount.ShouldBe(600m);
        unchanged.AmountPaid.ShouldBe(600m);
        unchanged.PendingAmendment.ShouldBeNull();
    }

    /// <summary>
    /// A top-up authorised before the customer cancelled, approved by the bank afterwards. The
    /// money lands on an order that has already settled up, so there is nothing for it to buy.
    /// It used to simply stay there — taken from the customer and never given back.
    /// </summary>
    [Fact]
    public async Task ATopUpThatLandsAfterTheOrderWasCancelled_GoesBackToTheCustomer()
    {
        await SetUpAsync();
        var order = await PlaceOrderAsync(Items(6)); // 600
        _factory.Cashfree.PayAllOutstanding();
        await CheckPaymentStatusAsync(order.Id);

        await EditOrderAsync(order.Id, Items(9)); // owes 300
        var topUpOrderId = _factory.Cashfree.CreatedOrderIds.Single(id => id != order.Id);
        _factory.Cashfree.LeaveAllOutstandingPending();
        await CheckPaymentAsync(order.Id);

        // The customer gives up waiting and cancels, which refunds the 600 to their wallet.
        var cancel = new HttpRequestMessage(HttpMethod.Patch, $"/api/orders/my/{order.Id}/cancel")
        {
            Content = JsonContent.Create(new CancelOrderRequest(RefundDestinations.Wallet)),
        };
        cancel.AttachCsrf(_csrf);
        (await _client.SendAsync(cancel)).StatusCode.ShouldBe(HttpStatusCode.OK);
        (await GetWalletAsync()).Balance.ShouldBe(600m);

        // Only now does the bank approve the top-up.
        _factory.Cashfree.SettlePending();
        await DeliverWebhookAsync(order.Id, topUpOrderId, 300m);

        // All 900 is back with the customer - the 600 from the cancellation and the 300 that
        // arrived too late to buy anything.
        (await GetWalletAsync()).Balance.ShouldBe(900m);
    }

    [Fact]
    public async Task CheckingPaymentStatusRepeatedly_NeverCountsTheSameMoneyTwice()
    {
        await SetUpAsync();
        var order = await PlaceOrderAsync(Items(6)); // 600
        _factory.Cashfree.PayAllOutstanding();

        // A customer refreshing, or the page retrying, must not inflate what the order holds.
        await CheckPaymentStatusAsync(order.Id);
        await CheckPaymentStatusAsync(order.Id);
        await CheckPaymentStatusAsync(order.Id);

        (await GetOrderAsync(order.Id)).AmountPaid.ShouldBe(600m);
    }

    [Fact]
    public async Task AStatusCheckAndAWebhookForTheSamePayment_RecordItOnlyOnce()
    {
        await SetUpAsync();
        var order = await PlaceOrderAsync(Items(6));
        _factory.Cashfree.PayAllOutstanding();

        await CheckPaymentStatusAsync(order.Id);
        // The webhook arrives afterwards carrying the very same payment. Recording is keyed on
        // Cashfree's payment id, so the second route to the same money is a no-op.
        await DeliverWebhookAsync(order.Id, order.Id, 600m);

        (await GetOrderAsync(order.Id)).AmountPaid.ShouldBe(600m);
    }

    [Fact]
    public async Task EditingUpTwiceWithoutPaying_AsksForTheWholeOutstandingAmount()
    {
        await SetUpAsync();
        var order = await PlaceOrderAsync(Items(6)); // 600
        _factory.Cashfree.PayAllOutstanding();
        await CheckPaymentStatusAsync(order.Id);

        var first = await EditOrderAsync(order.Id, Items(8)); // 800, owes 200
        first.TopUpAmount.ShouldBe(200m);

        // Edited again before paying that top-up: the ask is measured against what has actually
        // been paid (600), not against the previous ask.
        var second = await EditOrderAsync(order.Id, Items(10)); // 1000
        second.TopUpAmount.ShouldBe(400m);
    }

    [Fact]
    public async Task AFailedTopUp_LeavesTheOrderAndItsOriginalPaymentIntact()
    {
        await SetUpAsync();
        var order = await PlaceOrderAsync(Items(6));
        _factory.Cashfree.PayAllOutstanding();
        await CheckPaymentStatusAsync(order.Id);

        await EditOrderAsync(order.Id, Items(9)); // owes 300
        _factory.Cashfree.FailAllOutstanding();

        var status = await CheckPaymentStatusAsync(order.Id);

        // Only the extra went unpaid - cancelling the whole order here would be badly wrong. The
        // order goes back to being the settled 600 order it was before the edit.
        status.ShouldBe("Paid");
        var stillLive = await GetOrderAsync(order.Id);
        stillLive.Status.ShouldNotBe("Cancelled");
        stillLive.AmountPaid.ShouldBe(600m);
        stillLive.TotalAmount.ShouldBe(600m);
        stillLive.Items.Single().Quantity.ShouldBe(6);
        stillLive.PendingAmendment.ShouldBeNull();
    }

    /// <summary>
    /// The reported bug, in full. A customer edits a paid order upward, is sent to the payment
    /// page, and comes back without paying. Every part of that edit has to be gone: the items,
    /// the total, the demand for more money, and the stock it was holding. Applying the edit at
    /// save time meant none of it was — the customer was left looking at an order they hadn't
    /// paid for, being asked for money, with no way back.
    /// </summary>
    [Fact]
    public async Task LeavingTheTopUpPageWithoutPaying_LeavesTheOrderExactlyAsItWas()
    {
        await SetUpAsync();
        var order = await PlaceOrderAsync(Items(6)); // 600
        _factory.Cashfree.PayAllOutstanding();
        await CheckPaymentStatusAsync(order.Id);

        var edited = await EditOrderAsync(order.Id, Items(9)); // 900, owes 300
        edited.PendingPayment.ShouldBeTrue();

        // Back on the site having paid nothing - the gateway has no payment against the top-up.
        var status = await CheckPaymentStatusAsync(order.Id);

        status.ShouldBe("Paid"); // Not "PartiallyPaid": nothing is owed, there is nothing pending.
        var unchanged = await GetOrderAsync(order.Id);
        unchanged.Items.Single().Quantity.ShouldBe(6);
        unchanged.TotalAmount.ShouldBe(600m);
        unchanged.AmountPaid.ShouldBe(600m);
        unchanged.PendingAmendment.ShouldBeNull();
    }

    [Fact]
    public async Task AbandonedChangesPutTheirReservedStockBack()
    {
        await SetUpAsync();
        var productId = await SeedTrackedProductAsync(stock: 20);
        var order = await PlaceOrderAsync(TrackedItems(productId, 6));
        _factory.Cashfree.PayAllOutstanding();
        await CheckPaymentStatusAsync(order.Id);
        (await StockOfAsync(productId)).ShouldBe(14);

        // Staging holds the extra units, so nobody can buy what this customer is paying for...
        await EditOrderAsync(order.Id, TrackedItems(productId, 9));
        (await StockOfAsync(productId)).ShouldBe(11);

        // ...and abandoning the payment puts them straight back.
        await CheckPaymentStatusAsync(order.Id);
        (await StockOfAsync(productId)).ShouldBe(14);
    }

    [Fact]
    public async Task DiscardingChangesExplicitly_RestoresTheOrderAndItsStock()
    {
        await SetUpAsync();
        var productId = await SeedTrackedProductAsync(stock: 20);
        var order = await PlaceOrderAsync(TrackedItems(productId, 6));
        _factory.Cashfree.PayAllOutstanding();
        await CheckPaymentStatusAsync(order.Id);

        await EditOrderAsync(order.Id, TrackedItems(productId, 9));

        var request = new HttpRequestMessage(HttpMethod.Delete, $"/api/orders/my/{order.Id}/amendment");
        request.AttachCsrf(_csrf);
        var response = await _client.SendAsync(request);
        response.StatusCode.ShouldBe(HttpStatusCode.OK);

        var restored = (await response.Content.ReadFromJsonAsync<OrderResponse>())!;
        restored.PendingAmendment.ShouldBeNull();
        restored.Items.Single().Quantity.ShouldBe(6);
        restored.TotalAmount.ShouldBe(600m);
        (await StockOfAsync(productId)).ShouldBe(14);
    }

    /// <summary>
    /// A slow UPI collect that clears after its amendment was already dropped. The changes are
    /// gone, so the money can't buy anything — it must reach the customer rather than sitting on
    /// the order as an overpayment nobody notices.
    /// </summary>
    [Fact]
    public async Task ATopUpThatLandsAfterItsChangesWereDropped_GoesToTheWallet()
    {
        await SetUpAsync();
        var order = await PlaceOrderAsync(Items(6)); // 600
        _factory.Cashfree.PayAllOutstanding();
        await CheckPaymentStatusAsync(order.Id);

        await EditOrderAsync(order.Id, Items(9)); // owes 300
        var topUpOrderId = _factory.Cashfree.CreatedOrderIds.Single(id => id != order.Id);

        // The customer walks away, so the changes are dropped...
        await CheckPaymentStatusAsync(order.Id);
        (await GetOrderAsync(order.Id)).PendingAmendment.ShouldBeNull();

        // ...and only then does the bank confirm the charge.
        _factory.Cashfree.PayAllOutstanding();
        await DeliverWebhookAsync(order.Id, topUpOrderId, 300m);

        var settled = await GetOrderAsync(order.Id);
        settled.TotalAmount.ShouldBe(600m);
        settled.AmountPaid.ShouldBe(600m); // Not 900: the surplus was handed back, not kept.
        (await GetWalletAsync()).Balance.ShouldBe(300m);
    }

    /// <summary>
    /// A customer who reaches the payment page for a brand-new order and comes back without
    /// paying. The order can't be left sitting in their list saying "payment pending" forever: it
    /// holds stock nobody bought and gives them nothing to act on. It is stood down, the goods go
    /// back, and the reason is recorded so they are told what actually happened.
    /// </summary>
    [Fact]
    public async Task LeavingTheFirstPaymentWithoutPaying_StandsTheOrderDownAndReleasesTheStock()
    {
        await SetUpAsync();
        var productId = await SeedTrackedProductAsync(stock: 20);
        var order = await PlaceOrderAsync(TrackedItems(productId, 6));
        (await StockOfAsync(productId)).ShouldBe(14);

        // Straight back to the site without paying - the gateway has no payment at all.
        (await CheckPaymentStatusAsync(order.Id)).ShouldBe("Failed");

        var failed = await GetOrderAsync(order.Id);
        failed.Status.ShouldBe("Cancelled");
        failed.PaymentStatus.ShouldBe("Failed");
        failed.AmountPaid.ShouldBe(0m);
        failed.PaymentFailureReason.ShouldNotBeNullOrWhiteSpace();
        (await StockOfAsync(productId)).ShouldBe(20);
    }

    /// <summary>An order that failed can't be edited or cancelled - there is nothing to change,
    /// and the customer's only useful move is to order again.</summary>
    [Fact]
    public async Task AnOrderWhosePaymentFailed_CanNoLongerBeEdited()
    {
        await SetUpAsync();
        var order = await PlaceOrderAsync(Items(6));
        await CheckPaymentStatusAsync(order.Id);

        var request = new HttpRequestMessage(HttpMethod.Put, $"/api/orders/my/{order.Id}")
        {
            Content = JsonContent.Create(new UpdateMyOrderRequest(
                "Lifecycle Customer", "9123456789", "123 Main St", Lat, Lng, "", Items(9))),
        };
        request.AttachCsrf(_csrf);

        (await _client.SendAsync(request)).StatusCode.ShouldBe(HttpStatusCode.BadRequest);
    }

    /// <summary>Wallet credit is real money to the customer. An order that was never paid for
    /// must not keep the balance it spent, even though nothing left the business.</summary>
    [Fact]
    public async Task AFailedPayment_ReturnsTheWalletCreditItSpent()
    {
        await SetUpAsync();
        await _factory.SeedAsync(async db => await db.Users.UpdateOneAsync(
            u => u.Role == UserRoles.Customer,
            Builders<User>.Update.Set(u => u.WalletBalance, 250m)));

        // 600 total, 250 from wallet, 350 owed at the gateway - which never gets paid.
        var order = await PlaceOrderAsync(Items(6));
        order.WalletAmountApplied.ShouldBe(250m);
        (await GetWalletAsync()).Balance.ShouldBe(0m);

        (await CheckPaymentStatusAsync(order.Id)).ShouldBe("Failed");

        (await GetWalletAsync()).Balance.ShouldBe(250m);
        (await GetOrderAsync(order.Id)).AmountPaid.ShouldBe(0m);
    }

    /// <summary>Cashfree retries a webhook until it gets a 2xx, so the same failure arrives more
    /// than once. Standing the order down has to be the thing that claims the right to restore
    /// stock, or the shelf gains units that were never sold.</summary>
    [Fact]
    public async Task TheSameFailureWebhookTwice_RestoresStockOnlyOnce()
    {
        await SetUpAsync();
        var productId = await SeedTrackedProductAsync(stock: 20);
        var order = await PlaceOrderAsync(TrackedItems(productId, 6));
        (await StockOfAsync(productId)).ShouldBe(14);

        await DeliverFailureWebhookAsync(order.Id);
        await DeliverFailureWebhookAsync(order.Id);

        (await StockOfAsync(productId)).ShouldBe(20);
    }

    /// <summary>The gateway's own words reach the customer rather than being replaced by a guess
    /// about what a bank might have done.</summary>
    [Fact]
    public async Task AFailureWebhook_StoresTheReasonCashfreeGave()
    {
        await SetUpAsync();
        var order = await PlaceOrderAsync(Items(6));

        await DeliverFailureWebhookAsync(order.Id, "Insufficient funds in the account");

        (await GetOrderAsync(order.Id)).PaymentFailureReason
            .ShouldBe("Insufficient funds in the account");
    }

    /// <summary>
    /// Retrying a failed payment leaves the customer with one order to look at, not two. The dead
    /// attempt drops out of their list the moment its replacement exists — seeing a "Cancelled"
    /// order sitting above the one they just successfully placed is confusing and looks like
    /// something went wrong.
    /// </summary>
    [Fact]
    public async Task RetryingAFailedOrder_HidesTheAttemptItReplaces()
    {
        await SetUpAsync();
        var failed = await PlaceOrderAsync(Items(6));
        (await CheckPaymentStatusAsync(failed.Id)).ShouldBe("Failed");

        var retry = await PlaceRetryAsync(Items(6), retryOfOrderId: failed.Id);
        _factory.Cashfree.PayAllOutstanding();
        (await CheckPaymentStatusAsync(retry.Id)).ShouldBe("Paid");

        var mine = await _client.GetFromJsonAsync<List<OrderResponse>>("/api/orders/my");
        mine!.ShouldHaveSingleItem().Id.ShouldBe(retry.Id);

        // The trail is still there for support, just not in the customer's face.
        using var admin = _factory.CreateClient();
        await _factory.SeedAndLoginAsStaffAsync(admin, UserRoles.Admin);
        var all = await admin.GetFromJsonAsync<List<OrderResponse>>("/api/orders/admin/all");
        all!.Select(o => o.Id).ShouldContain(failed.Id);
    }

    /// <summary>A retry can only retire the caller's own failed order - the id comes from the
    /// browser, so it must never be usable to make somebody else's order disappear.</summary>
    [Fact]
    public async Task ARetryCannotHideAnOrderThatIsNotTheCustomersOwnFailedOne()
    {
        await SetUpAsync();
        // A live, paid order - not a failed one, and so not something a "retry" may retire.
        var live = await PlaceOrderAsync(Items(6));
        _factory.Cashfree.PayAllOutstanding();
        (await CheckPaymentStatusAsync(live.Id)).ShouldBe("Paid");

        await PlaceRetryAsync(Items(4), retryOfOrderId: live.Id);

        var mine = await _client.GetFromJsonAsync<List<OrderResponse>>("/api/orders/my");
        mine!.Select(o => o.Id).ShouldContain(live.Id);
    }

    private async Task<OrderResponse> PlaceRetryAsync(List<OrderItemDto> items, string retryOfOrderId)
    {
        var request = new HttpRequestMessage(HttpMethod.Post, "/api/orders")
        {
            Content = JsonContent.Create(new PlaceOrderRequest(
                "Lifecycle Customer", "9123456789", "123 Main St", Lat, Lng, "", items,
                CouponCode: null, UseWallet: true, RetryOfOrderId: retryOfOrderId)),
        };
        request.AttachCsrf(_csrf);
        var response = await _client.SendAsync(request);
        response.StatusCode.ShouldBe(HttpStatusCode.OK);
        return (await response.Content.ReadFromJsonAsync<OrderResponse>())!;
    }

    private async Task DeliverFailureWebhookAsync(
        string cashfreeOrderId, string reason = "Card declined")
    {
        var body =
            "{\"type\":\"PAYMENT_FAILED_WEBHOOK\",\"event_time\":\"2026-08-23T00:00:00Z\",\"data\":{\"order\":{\"order_id\":\"" +
            cashfreeOrderId + "\"},\"payment\":{\"payment_status\":\"FAILED\"},\"error_details\":{\"error_description\":\"" +
            reason + "\"}}}";

        var timestamp = "1700000000";
        var request = new HttpRequestMessage(HttpMethod.Post, "/api/payments/cashfree/webhook")
        {
            Content = new StringContent(body, System.Text.Encoding.UTF8, "application/json"),
        };
        request.Headers.Add("x-webhook-timestamp", timestamp);
        request.Headers.Add("x-webhook-signature", Sign(timestamp + body));

        (await _client.SendAsync(request)).StatusCode.ShouldBe(HttpStatusCode.OK);
    }

    /// <summary>Products are seeded with tracked stock only where a test is about stock; the
    /// other tests use an untracked id, which the stock helpers deliberately skip.</summary>
    private async Task<string> SeedTrackedProductAsync(int stock)
    {
        var product = new Product
        {
            Name = "Tracked Product",
            Description = "",
            Price = 100m,
            Category = "Flour",
            Weight = "1kg",
            StockQuantity = stock,
        };
        await _factory.SeedAsync(async db => await db.Products.InsertOneAsync(product));
        return product.Id!;
    }

    private static List<OrderItemDto> TrackedItems(string productId, int quantity) =>
        [new(productId, "Tracked Product", 100m, "1kg", quantity)];

    private async Task<int?> StockOfAsync(string productId)
    {
        int? stock = null;
        await _factory.SeedAsync(async db =>
        {
            var product = await db.Products.Find(p => p.Id == productId).FirstOrDefaultAsync();
            stock = product?.StockQuantity;
        });
        return stock;
    }

    private async Task DeliverWebhookAsync(string ojasOrderId, string cashfreeOrderId, decimal amount)
    {
        var body =
            "{\"type\":\"PAYMENT_SUCCESS_WEBHOOK\",\"event_time\":\"2026-08-23T00:00:00Z\",\"data\":{\"order\":{\"order_id\":\"" +
            cashfreeOrderId + "\"},\"payment\":{\"cf_payment_id\":\"" + CfPaymentIdFor(cashfreeOrderId) +
            "\",\"payment_status\":\"SUCCESS\",\"payment_group\":\"upi\",\"payment_amount\":" + amount + "}}}";

        var timestamp = "1700000000";
        var request = new HttpRequestMessage(HttpMethod.Post, "/api/payments/cashfree/webhook")
        {
            Content = new StringContent(body, System.Text.Encoding.UTF8, "application/json"),
        };
        request.Headers.Add("x-webhook-timestamp", timestamp);
        request.Headers.Add("x-webhook-signature", Sign(timestamp + body));

        var response = await _client.SendAsync(request);
        response.StatusCode.ShouldBe(HttpStatusCode.OK);
        _ = ojasOrderId;
    }

    /// <summary>The fake gateway mints one payment id per gateway order; the webhook has to carry
    /// that same id for the de-duplication under test to be exercised at all.</summary>
    private string CfPaymentIdFor(string cashfreeOrderId)
    {
        var service = _factory.Cashfree.Service();
        var payments = service.GetPaymentsAsync(cashfreeOrderId).GetAwaiter().GetResult();
        return payments.Single().CfPaymentId;
    }

    private static string Sign(string payload)
    {
        using var hmac = new System.Security.Cryptography.HMACSHA256(
            System.Text.Encoding.UTF8.GetBytes(TestHelpers.FakeCashfreeHandler.ClientSecret));
        return Convert.ToBase64String(hmac.ComputeHash(System.Text.Encoding.UTF8.GetBytes(payload)));
    }
    [Fact]
    public async Task AnOfferAppliedOnTheGatewayPage_SettlesTheOrderInFull()
    {
        await SetUpAsync();
        var order = await PlaceOrderAsync(Items(6)); // 600

        // The customer applies an offer on Cashfree's own page and is charged 550, not 600.
        // Cashfree still reports the gateway order PAID.
        _factory.Cashfree.ApplyOfferToAllOutstanding(50m);
        _factory.Cashfree.PayAllOutstanding();

        // Summing what the customer was charged gives 550 against a 600 total, which used to
        // leave the order at PartiallyPaid forever - telling them to pay a difference the offer
        // had already covered.
        (await CheckPaymentStatusAsync(order.Id)).ShouldBe("Paid");

        var settled = await GetOrderAsync(order.Id);
        settled.AmountPaid.ShouldBe(550m);        // money that actually reached us
        settled.GatewayDiscount.ShouldBe(50m);    // and what the gateway covered
        settled.PaymentStatus.ShouldBe("Paid");
    }

    [Fact]
    public async Task RecheckingAnOfferedOrder_DoesNotCountTheDiscountTwice()
    {
        await SetUpAsync();
        var order = await PlaceOrderAsync(Items(6)); // 600
        _factory.Cashfree.ApplyOfferToAllOutstanding(50m);
        _factory.Cashfree.PayAllOutstanding();

        // Reconciliation runs on every status check and on every webhook retry. An offer
        // re-reported must land once, for the same reason a payment does.
        await CheckPaymentStatusAsync(order.Id);
        await CheckPaymentStatusAsync(order.Id);
        await CheckPaymentStatusAsync(order.Id);

        var settled = await GetOrderAsync(order.Id);
        settled.GatewayDiscount.ShouldBe(50m);
        settled.AmountPaid.ShouldBe(550m);
    }

    [Fact]
    public async Task AnOfferOnATopUp_IsCountedAgainstTheTopUpToo()
    {
        await SetUpAsync();
        var order = await PlaceOrderAsync(Items(6)); // 600
        _factory.Cashfree.PayAllOutstanding();
        await CheckPaymentStatusAsync(order.Id);

        await EditOrderAsync(order.Id, Items(9)); // owes 300 more

        // The top-up is its own gateway order, so it carries its own offer.
        _factory.Cashfree.ApplyOfferToAllOutstanding(30m);
        _factory.Cashfree.PayAllOutstanding();
        (await CheckPaymentStatusAsync(order.Id)).ShouldBe("Paid");

        var settled = await GetOrderAsync(order.Id);
        settled.GatewayDiscount.ShouldBe(30m);
        // Money received falls short of the total by exactly the offer, and the two together
        // settle it. Asserting the relationship rather than the arithmetic keeps this test about
        // discounts instead of about the delivery-charge and coupon rules that set the total.
        (settled.AmountPaid + settled.GatewayDiscount).ShouldBeGreaterThanOrEqualTo(settled.TotalAmount);
        settled.AmountPaid.ShouldBe(settled.TotalAmount - 30m);
    }

}
