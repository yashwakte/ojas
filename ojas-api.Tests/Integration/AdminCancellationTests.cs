using System.Net;
using System.Net.Http.Json;
using MongoDB.Driver;
using OjasApi.Models;
using Shouldly;

namespace OjasApi.Tests.Integration;

/// <summary>
/// An admin cancelling a paid order has to give the money back.
///
/// It used to give back only the goods: the admin status endpoint restored stock and left the
/// customer's payment sitting on a cancelled order, while the customer's own cancel handler — the
/// only one anybody had checked — refunded properly. So whether a customer got their money back
/// depended entirely on who pressed cancel. These tests pin the behaviour to the money, not to
/// the caller, and cover the shapes a real order actually comes in: paid at the gateway, paid
/// from wallet, paid partly by each, and paid across two gateway orders because it was topped up.
/// </summary>
[Collection(MongoCollectionFixture.Name)]
public class AdminCancellationTests : IDisposable
{
    private readonly OjasApiFactory _factory;
    private readonly HttpClient _customer;

    public AdminCancellationTests(MongoRunnerFixture mongo)
    {
        _factory = new OjasApiFactory(mongo);
        _customer = _factory.CreateClient();
    }

    public void Dispose()
    {
        _customer.Dispose();
        _factory.Dispose();
    }

    private const double WarehouseLat = 18.0;
    private const double Lng = 73.0;
    private const double Lat = 18.01;

    private Product _product = null!;
    private string _customerCsrf = string.Empty;

    private async Task SeedAsync(decimal price = 100m)
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
        _product = await _factory.SeedProductAsync(price: price, stock: 100);
    }

    private async Task<OrderResponse> PlaceAsync(int quantity)
    {
        var (_, csrf) = await _customer.RegisterAsync(fullName: "Cancel Customer");
        _customerCsrf = csrf;

        var request = new HttpRequestMessage(HttpMethod.Post, "/api/orders")
        {
            Content = JsonContent.Create(new PlaceOrderRequest(
                "Cancel Customer", "9123456789", "123 Main St", Lat, Lng, "",
                [new(_product.Id!, _product.Name, _product.Price, _product.Weight, quantity)])),
        };
        request.AttachCsrf(csrf);

        var response = await _customer.SendAsync(request);
        response.StatusCode.ShouldBe(HttpStatusCode.OK);
        return (await response.Content.ReadFromJsonAsync<OrderResponse>())!;
    }

    /// <summary>Completes payment the way returning from the hosted checkout page does — through
    /// the real status check, so the payment is recorded by the code that records real ones.</summary>
    private async Task PayAsync(string orderId)
    {
        _factory.Cashfree.PayAllOutstanding();
        (await _customer.GetAsync($"/api/payments/cashfree/status/{orderId}"))
            .StatusCode.ShouldBe(HttpStatusCode.OK);
    }

    private async Task<(HttpClient Client, string Csrf)> AdminAsync()
    {
        var admin = _factory.CreateClient();
        var (_, csrf) = await _factory.SeedAndLoginAsStaffAsync(admin, UserRoles.Admin);
        return (admin, csrf);
    }

    private static HttpRequestMessage StatusRequest(string orderId, string status, string csrf)
    {
        var request = new HttpRequestMessage(HttpMethod.Patch, $"/api/orders/admin/{orderId}/status")
        {
            Content = JsonContent.Create(new UpdateOrderStatusRequest(status)),
        };
        request.AttachCsrf(csrf);
        return request;
    }

    private async Task<AdminStatusChangeResponse> CancelAsAdminAsync(string orderId)
    {
        var (admin, csrf) = await AdminAsync();
        using var _ = admin;
        var response = await admin.SendAsync(StatusRequest(orderId, "Cancelled", csrf));
        response.StatusCode.ShouldBe(HttpStatusCode.OK);
        return (await response.Content.ReadFromJsonAsync<AdminStatusChangeResponse>())!;
    }

    private async Task<Order> ReadOrderAsync(string orderId)
    {
        Order? order = null;
        await _factory.SeedAsync(async db =>
            order = await db.Orders.Find(o => o.Id == orderId).FirstOrDefaultAsync());
        return order!;
    }

    private async Task<decimal> WalletBalanceAsync() =>
        (await _customer.GetFromJsonAsync<WalletResponse>("/api/wallet"))!.Balance;

    /// <summary>Puts credit in the customer's wallet so an order can be paid partly, or wholly,
    /// out of it — which is the case where some of a refund can only ever go back to the wallet.</summary>
    private async Task GiveWalletCreditAsync(decimal amount) =>
        await _factory.SeedAsync(async db => await db.Users.UpdateOneAsync(
            u => u.Role == UserRoles.Customer,
            Builders<User>.Update.Set(u => u.WalletBalance, amount)));

    // ---------- the bug ----------

    /// <summary>
    /// The report that started this: a customer pays by UPI, an admin cancels, and the money is
    /// simply kept. The refund has to go back to the card or UPI account it came from — a
    /// merchant-initiated cancellation must not quietly convert someone's payment into store
    /// credit they never asked for.
    /// </summary>
    [Fact]
    public async Task AdminCancellingAPaidOrder_RefundsItToTheOriginalPaymentMethod()
    {
        await SeedAsync();
        var order = await PlaceAsync(quantity: 6);
        await PayAsync(order.Id);

        var paid = (await ReadOrderAsync(order.Id)).AmountPaid;
        paid.ShouldBeGreaterThan(0m);

        var result = await CancelAsAdminAsync(order.Id);

        result.RefundedToSource.ShouldBe(paid);
        result.SourceRefundQueued.ShouldBe(0m);
        result.Order!.Status.ShouldBe("Cancelled");

        // The money actually left through the gateway, against the gateway order that took it.
        _factory.Cashfree.Refunds.ShouldHaveSingleItem();
        _factory.Cashfree.Refunds[0].GatewayOrderId.ShouldBe(order.Id);
        _factory.Cashfree.Refunds[0].Amount.ShouldBe(paid);

        var stored = await ReadOrderAsync(order.Id);
        stored.AmountPaid.ShouldBe(0m);
        stored.AmountRefunded.ShouldBe(paid);
        stored.RefundPendingAmount.ShouldBeNull();
    }

    /// <summary>
    /// Money paid from wallet credit can only go back to the wallet — there is no card behind it
    /// to refund to. The gateway share still goes back to the gateway, so a part-wallet order is
    /// returned along the two routes it arrived by rather than being lumped onto one.
    /// </summary>
    [Fact]
    public async Task AdminCancellingAPartWalletOrder_SplitsTheRefundTheWayItWasPaid()
    {
        await SeedAsync();
        var (_, csrf) = await _customer.RegisterAsync(fullName: "Cancel Customer");
        _customerCsrf = csrf;

        // The credit has to exist before checkout, which is what applies it to the order.
        await GiveWalletCreditAsync(200m);

        var request = new HttpRequestMessage(HttpMethod.Post, "/api/orders")
        {
            Content = JsonContent.Create(new PlaceOrderRequest(
                "Cancel Customer", "9123456789", "123 Main St", Lat, Lng, "",
                [new(_product.Id!, _product.Name, _product.Price, _product.Weight, 6)])),
        };
        request.AttachCsrf(_customerCsrf);
        var order = (await (await _customer.SendAsync(request)).Content.ReadFromJsonAsync<OrderResponse>())!;

        order.WalletAmountApplied.ShouldBe(200m);
        await PayAsync(order.Id);

        var beforeBalance = await WalletBalanceAsync();
        var stored = await ReadOrderAsync(order.Id);
        var gatewayShare = stored.AmountPaid - 200m;
        gatewayShare.ShouldBeGreaterThan(0m);

        var result = await CancelAsAdminAsync(order.Id);

        result.WalletCredited.ShouldBe(200m);
        result.RefundedToSource.ShouldBe(gatewayShare);
        (await WalletBalanceAsync()).ShouldBe(beforeBalance + 200m);

        // Only the gateway-funded share was ever sent to the gateway.
        _factory.Cashfree.Refunds.Sum(r => r.Amount).ShouldBe(gatewayShare);
        (await ReadOrderAsync(order.Id)).AmountPaid.ShouldBe(0m);
    }

    /// <summary>
    /// A topped-up order holds its money across two gateway orders, because a Cashfree order's
    /// amount cannot be amended and the difference is charged as its own. Aiming the whole refund
    /// at the original id — which is what the refund endpoint used to do — would try to take more
    /// than that leg captured and leave the top-up untouched. This is the "upi + card" case.
    /// </summary>
    [Fact]
    public async Task AdminCancellingAToppedUpOrder_RefundsEveryGatewayOrderThatHoldsMoney()
    {
        await SeedAsync();
        var order = await PlaceAsync(quantity: 6);
        await PayAsync(order.Id);
        var firstPayment = (await ReadOrderAsync(order.Id)).AmountPaid;

        // An edit that adds items raises the total, which is charged as its own gateway order.
        var edit = new HttpRequestMessage(HttpMethod.Put, $"/api/orders/my/{order.Id}")
        {
            Content = JsonContent.Create(new UpdateMyOrderRequest(
                "Cancel Customer", "9123456789", "123 Main St", Lat, Lng, "",
                [new(_product.Id!, _product.Name, _product.Price, _product.Weight, 10)])),
        };
        edit.AttachCsrf(_customerCsrf);
        (await _customer.SendAsync(edit)).StatusCode.ShouldBe(HttpStatusCode.OK);

        await PayAsync(order.Id);

        var stored = await ReadOrderAsync(order.Id);
        stored.Payments.Count.ShouldBe(2);
        var total = stored.AmountPaid;
        total.ShouldBeGreaterThan(firstPayment);

        var result = await CancelAsAdminAsync(order.Id);

        result.RefundedToSource.ShouldBe(total);
        result.SourceRefundQueued.ShouldBe(0m);

        // One refund per gateway order, each for what that leg actually captured — not one lump
        // aimed at the original id.
        _factory.Cashfree.Refunds.Count.ShouldBe(2);
        _factory.Cashfree.Refunds.Select(r => r.GatewayOrderId).Distinct().Count().ShouldBe(2);
        _factory.Cashfree.Refunds.Sum(r => r.Amount).ShouldBe(total);

        (await ReadOrderAsync(order.Id)).AmountPaid.ShouldBe(0m);
    }

    /// <summary>
    /// The gateway refusing the payout must not lose the money. The order is still cancelled —
    /// the goods are back and the customer is not left waiting on us — but what is owed is
    /// recorded so an admin sees it and can retry, rather than it vanishing into a log line.
    /// </summary>
    [Fact]
    public async Task WhenTheGatewayRefusesTheRefund_TheAmountIsRecordedAsOwedRatherThanLost()
    {
        await SeedAsync();
        var order = await PlaceAsync(quantity: 6);
        await PayAsync(order.Id);
        var paid = (await ReadOrderAsync(order.Id)).AmountPaid;

        _factory.Cashfree.FailRefunds = true;
        var result = await CancelAsAdminAsync(order.Id);

        result.RefundedToSource.ShouldBe(0m);
        result.SourceRefundQueued.ShouldBe(paid);
        result.RefundError.ShouldNotBeNull();

        var stored = await ReadOrderAsync(order.Id);
        stored.Status.ShouldBe("Cancelled");
        stored.RefundPendingAmount.ShouldBe(paid);
        // Nothing was sent, so the order must not believe it refunded anything.
        stored.AmountPaid.ShouldBe(paid);
        stored.AmountRefunded.ShouldBe(0m);

        // And the admin can put it right once the gateway is healthy again.
        _factory.Cashfree.FailRefunds = false;
        var (admin, csrf) = await AdminAsync();
        using var _ = admin;
        var retry = new HttpRequestMessage(HttpMethod.Post, $"/api/orders/admin/{order.Id}/refund")
        {
            Content = JsonContent.Create(new RefundOrderRequest(paid, "retry")),
        };
        retry.AttachCsrf(csrf);
        (await admin.SendAsync(retry)).StatusCode.ShouldBe(HttpStatusCode.OK);

        var settled = await ReadOrderAsync(order.Id);
        settled.AmountPaid.ShouldBe(0m);
        settled.AmountRefunded.ShouldBe(paid);
        settled.RefundPendingAmount.ShouldBeNull();
    }

    /// <summary>
    /// An admin double-clicking Save, or two admins acting at once. Cancelling hands back goods
    /// and money, so it has to happen exactly once — the old code read the status and wrote it
    /// afterwards, which two requests sent together both got past.
    /// </summary>
    [Fact]
    public async Task CancellingTwice_RefundsOnlyOnce()
    {
        await SeedAsync();
        var order = await PlaceAsync(quantity: 6);
        await PayAsync(order.Id);
        var paid = (await ReadOrderAsync(order.Id)).AmountPaid;

        var (admin, csrf) = await AdminAsync();
        using var _ = admin;

        var attempts = Enumerable.Range(0, 5)
            .Select(_ => admin.SendAsync(StatusRequest(order.Id, "Cancelled", csrf)))
            .ToArray();
        await Task.WhenAll(attempts);

        _factory.Cashfree.Refunds.Sum(r => r.Amount).ShouldBe(paid);
        var stored = await ReadOrderAsync(order.Id);
        stored.AmountRefunded.ShouldBe(paid);
        stored.AmountPaid.ShouldBe(0m);
    }

    /// <summary>An order nobody ever paid for has nothing to give back, and must not conjure a
    /// gateway refund out of an amount of zero.</summary>
    [Fact]
    public async Task AdminCancellingAnUnpaidOrder_RefundsNothing()
    {
        await SeedAsync();
        var order = await PlaceAsync(quantity: 6);

        var result = await CancelAsAdminAsync(order.Id);

        result.RefundedToSource.ShouldBe(0m);
        result.WalletCredited.ShouldBe(0m);
        result.SourceRefundQueued.ShouldBe(0m);
        _factory.Cashfree.Refunds.ShouldBeEmpty();
        result.Order!.Status.ShouldBe("Cancelled");
    }

    /// <summary>A status change that isn't a cancellation still returns the order, so the
    /// dashboard swaps in what the server has rather than patching its own copy.</summary>
    [Fact]
    public async Task AnOrdinaryStatusChange_ReturnsTheUpdatedOrderAndTouchesNoMoney()
    {
        await SeedAsync();
        var order = await PlaceAsync(quantity: 6);
        await PayAsync(order.Id);

        var (admin, csrf) = await AdminAsync();
        using var _ = admin;
        var response = await admin.SendAsync(StatusRequest(order.Id, "Packed", csrf));
        response.StatusCode.ShouldBe(HttpStatusCode.OK);

        var result = (await response.Content.ReadFromJsonAsync<AdminStatusChangeResponse>())!;
        result.Order!.Status.ShouldBe("Packed");
        result.RefundedToSource.ShouldBe(0m);
        _factory.Cashfree.Refunds.ShouldBeEmpty();
    }

    /// <summary>The figure the admin is asked to confirm against has to be the real one, and it
    /// has to come from the server rather than the dashboard's own arithmetic.</summary>
    [Fact]
    public async Task TheCancellationPreview_ReportsWhatWouldActuallyBeHandedBack()
    {
        await SeedAsync();
        var order = await PlaceAsync(quantity: 6);
        await PayAsync(order.Id);
        var paid = (await ReadOrderAsync(order.Id)).AmountPaid;

        var (admin, _) = await AdminAsync();
        using var __ = admin;
        var preview = await admin.GetFromJsonAsync<CancellationPreviewResponse>(
            $"/api/orders/admin/{order.Id}/cancellation-preview");

        preview!.AmountPaid.ShouldBe(paid);
        preview.GatewayShare.ShouldBe(paid);
        preview.WalletShare.ShouldBe(0m);
        preview.HasPendingAmendment.ShouldBeFalse();
    }

    /// <summary>Posts a REFUND_STATUS_WEBHOOK the way Cashfree does — the refund's own outcome,
    /// which arrives long after the refund was created and answered "PENDING".</summary>
    private async Task DeliverRefundWebhookAsync(string orderId, string refundId, string status)
    {
        var body =
            "{\"type\":\"REFUND_STATUS_WEBHOOK\",\"event_time\":\"2026-08-28T00:00:00Z\",\"data\":{\"refund\":{" +
            "\"refund_id\":\"" + refundId + "\",\"order_id\":\"" + orderId +
            "\",\"refund_status\":\"" + status + "\",\"refund_amount\":0}}}";

        var timestamp = "1700000000";
        var request = new HttpRequestMessage(HttpMethod.Post, "/api/payments/cashfree/webhook")
        {
            Content = new StringContent(body, System.Text.Encoding.UTF8, "application/json"),
        };
        request.Headers.Add("x-webhook-timestamp", timestamp);
        request.Headers.Add("x-webhook-signature", Sign(timestamp + body));

        (await _customer.SendAsync(request)).StatusCode.ShouldBe(HttpStatusCode.OK);
    }

    private static string Sign(string payload)
    {
        using var hmac = new System.Security.Cryptography.HMACSHA256(
            System.Text.Encoding.UTF8.GetBytes(TestHelpers.FakeCashfreeHandler.ClientSecret));
        return Convert.ToBase64String(hmac.ComputeHash(System.Text.Encoding.UTF8.GetBytes(payload)));
    }

    /// <summary>
    /// Creating a refund answers PENDING, never SUCCESS — the acquiring bank can reject it days
    /// later, and the customer's card is then never credited. Taking the create as proof the money
    /// went back would leave the order showing a refund that never happened, which is the same lie
    /// as not refunding at all and much harder to spot.
    /// </summary>
    [Fact]
    public async Task ARefundTheBankLaterRejects_GoesBackOnTheOrderAsStillOwed()
    {
        await SeedAsync();
        var order = await PlaceAsync(quantity: 6);
        await PayAsync(order.Id);
        var paid = (await ReadOrderAsync(order.Id)).AmountPaid;

        var result = await CancelAsAdminAsync(order.Id);
        result.RefundedToSource.ShouldBe(paid);

        var refundId = (await ReadOrderAsync(order.Id)).Refunds.ShouldHaveSingleItem().RefundId;

        await DeliverRefundWebhookAsync(order.Id, refundId, "FAILED");

        var stored = await ReadOrderAsync(order.Id);
        // The money never left, so the order holds it again and it is owed to the customer.
        stored.AmountPaid.ShouldBe(paid);
        stored.AmountRefunded.ShouldBe(0m);
        stored.RefundPendingAmount.ShouldBe(paid);
        stored.Status.ShouldBe("Cancelled");

        // And it is refundable again rather than counted as already handed back.
        stored.RefundableByGatewayOrder(order.Id)[order.Id].ShouldBe(paid);
    }

    /// <summary>Cashfree retries a webhook until it gets a 2xx, so the same bounce arrives more
    /// than once. Undoing the refund twice would credit the order with money that was never
    /// there.</summary>
    [Fact]
    public async Task TheSameBouncedRefundArrivingTwice_IsUndoneOnce()
    {
        await SeedAsync();
        var order = await PlaceAsync(quantity: 6);
        await PayAsync(order.Id);
        var paid = (await ReadOrderAsync(order.Id)).AmountPaid;

        await CancelAsAdminAsync(order.Id);
        var refundId = (await ReadOrderAsync(order.Id)).Refunds.ShouldHaveSingleItem().RefundId;

        await DeliverRefundWebhookAsync(order.Id, refundId, "FAILED");
        await DeliverRefundWebhookAsync(order.Id, refundId, "FAILED");
        await DeliverRefundWebhookAsync(order.Id, refundId, "FAILED");

        var stored = await ReadOrderAsync(order.Id);
        stored.AmountPaid.ShouldBe(paid);
        stored.RefundPendingAmount.ShouldBe(paid);
    }

    /// <summary>A refund that succeeds is recorded as such and changes nothing about the money —
    /// it was already taken off the order when the refund was raised.</summary>
    [Fact]
    public async Task ARefundConfirmedSuccessful_LeavesTheOrderSettled()
    {
        await SeedAsync();
        var order = await PlaceAsync(quantity: 6);
        await PayAsync(order.Id);
        var paid = (await ReadOrderAsync(order.Id)).AmountPaid;

        await CancelAsAdminAsync(order.Id);
        var refundId = (await ReadOrderAsync(order.Id)).Refunds.ShouldHaveSingleItem().RefundId;

        await DeliverRefundWebhookAsync(order.Id, refundId, "SUCCESS");

        var stored = await ReadOrderAsync(order.Id);
        stored.AmountPaid.ShouldBe(0m);
        stored.AmountRefunded.ShouldBe(paid);
        stored.RefundPendingAmount.ShouldBeNull();
        stored.Refunds[0].Status.ShouldBe("SUCCESS");
    }

    /// <summary>
    /// A cancellation routinely splits: the wallet-funded share can only ever return to the
    /// wallet, and the rest goes back to the card. The order has to say which is which — one
    /// total sends the customer hunting a card statement for money that was never coming there.
    /// </summary>
    [Fact]
    public async Task ThePartWalletRefund_IsReportedSplitByDestination()
    {
        await SeedAsync();
        var (_, csrf) = await _customer.RegisterAsync(fullName: "Cancel Customer");
        _customerCsrf = csrf;
        await GiveWalletCreditAsync(200m);

        var request = new HttpRequestMessage(HttpMethod.Post, "/api/orders")
        {
            Content = JsonContent.Create(new PlaceOrderRequest(
                "Cancel Customer", "9123456789", "123 Main St", Lat, Lng, "",
                [new(_product.Id!, _product.Name, _product.Price, _product.Weight, 6)])),
        };
        request.AttachCsrf(_customerCsrf);
        var order = (await (await _customer.SendAsync(request)).Content.ReadFromJsonAsync<OrderResponse>())!;
        await PayAsync(order.Id);

        var gatewayShare = (await ReadOrderAsync(order.Id)).AmountPaid - 200m;

        var result = await CancelAsAdminAsync(order.Id);

        result.Order!.RefundedToWallet.ShouldBe(200m);
        result.Order.RefundedToSource.ShouldBe(gatewayShare);
        // And the two together are the whole of what was handed back, with nothing unaccounted for.
        result.Order.AmountRefunded.ShouldBe(200m + gatewayShare);
    }

    /// <summary>A refund the bank bounced was never handed to the customer, so it must stop
    /// counting towards what went back to source.</summary>
    [Fact]
    public async Task ABouncedRefund_StopsCountingTowardsWhatWentBackToSource()
    {
        await SeedAsync();
        var order = await PlaceAsync(quantity: 6);
        await PayAsync(order.Id);

        await CancelAsAdminAsync(order.Id);
        var refundId = (await ReadOrderAsync(order.Id)).Refunds.ShouldHaveSingleItem().RefundId;
        await DeliverRefundWebhookAsync(order.Id, refundId, "FAILED");

        var stored = await ReadOrderAsync(order.Id);
        stored.RefundedToSource.ShouldBe(0m);
        stored.RefundedToWallet.ShouldBe(0m);
    }
}
