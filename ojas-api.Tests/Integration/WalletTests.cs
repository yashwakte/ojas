using System.Net;
using System.Net.Http.Json;
using MongoDB.Driver;
using OjasApi.Models;
using Shouldly;

namespace OjasApi.Tests.Integration;

/// <summary>
/// The wallet is closed-loop store credit: spendable on Ojas, never withdrawable. These cover
/// the two ways balance moves — spent at checkout, and credited back when an order is cancelled
/// — plus the rule that a customer's own action never moves real money without an admin.
/// </summary>
[Collection(MongoCollectionFixture.Name)]
public class WalletTests : IDisposable
{
    private readonly OjasApiFactory _factory;
    private readonly HttpClient _client;
    private string _csrf = string.Empty;

    public WalletTests(MongoRunnerFixture mongo)
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
    }

    private async Task RegisterAsync()
    {
        var (_, csrf) = await _client.RegisterAsync(fullName: "Wallet Customer");
        _csrf = csrf;
        _product = await _factory.SeedProductAsync(price: 100m);
    }

    /// <summary>Puts credit in the wallet directly, standing in for however it got there.</summary>
    private async Task SeedWalletAsync(decimal balance)
    {
        var wallet = await GetWalletAsync();
        wallet.Balance.ShouldBe(0m);
        await _factory.SeedAsync(async db => await db.Users.UpdateOneAsync(
            u => u.Role == UserRoles.Customer,
            Builders<User>.Update.Set(u => u.WalletBalance, balance)));
    }

    /// <summary>The catalog product these tests order. Orders are priced server-side from the
    /// catalog, so it has to be a real one — the price passed here is ignored by the API and only
    /// kept so the request looks like a browser's.</summary>
    private Product _product = null!;

    private List<OrderItemDto> Items(int quantity, decimal price = 100m) =>
        [new(_product.Id!, _product.Name, price, _product.Weight, quantity)];

    private async Task<HttpResponseMessage> PlaceOrderRawAsync(List<OrderItemDto> items, bool useWallet = true)
    {
        var request = new PlaceOrderRequest(
            "Wallet Customer", "9123456789", "123 Main St", Lat, Lng, "", items, null, useWallet);
        var httpRequest = new HttpRequestMessage(HttpMethod.Post, "/api/orders")
        {
            Content = JsonContent.Create(request),
        };
        httpRequest.AttachCsrf(_csrf);
        return await _client.SendAsync(httpRequest);
    }

    private async Task<OrderResponse> PlaceOrderAsync(List<OrderItemDto> items, bool useWallet = true)
    {
        var response = await PlaceOrderRawAsync(items, useWallet);
        response.StatusCode.ShouldBe(HttpStatusCode.OK);
        return (await response.Content.ReadFromJsonAsync<OrderResponse>())!;
    }

    private async Task<WalletResponse> GetWalletAsync() =>
        (await _client.GetFromJsonAsync<WalletResponse>("/api/wallet"))!;

    private async Task<CancelOrderResponse> CancelAsync(string orderId, string destination)
    {
        var request = new HttpRequestMessage(HttpMethod.Patch, $"/api/orders/my/{orderId}/cancel")
        {
            Content = JsonContent.Create(new CancelOrderRequest(destination)),
        };
        request.AttachCsrf(_csrf);
        var response = await _client.SendAsync(request);
        response.StatusCode.ShouldBe(HttpStatusCode.OK);
        return (await response.Content.ReadFromJsonAsync<CancelOrderResponse>())!;
    }

    /// <summary>Records a real gateway payment rather than setting the paid figure directly:
    /// that figure is derived from recorded payments, so a bare assignment would be recomputed
    /// away. The wallet-funded share is already on the order from checkout.</summary>
    private async Task MarkPaidAsync(string orderId, decimal amountPaid)
    {
        var order = await GetOrderAsync(orderId);
        var gatewayShare = amountPaid - order.WalletAmountApplied;

        await _factory.SeedAsync(async db =>
        {
            var update = Builders<Order>.Update
                .Set(o => o.AmountPaid, amountPaid)
                .Set(o => o.PaymentStatus, "Paid");

            if (gatewayShare > 0)
            {
                update = update.Push(o => o.Payments, new OrderPayment
                {
                    CfPaymentId = $"cf_pay_{Guid.NewGuid():N}",
                    Amount = gatewayShare,
                    Instrument = "upi",
                });
            }

            await db.Orders.UpdateOneAsync(o => o.Id == orderId, update);
        });
    }

    private async Task<OrderResponse> GetOrderAsync(string orderId)
    {
        var orders = await _client.GetFromJsonAsync<List<OrderResponse>>("/api/orders/my");
        return orders!.Single(o => o.Id == orderId);
    }

    // ---------- spending at checkout ----------

    [Fact]
    public async Task AnEmptyWallet_ChangesNothingAboutCheckout()
    {
        await SeedDeliveryChargesAsync();
        await RegisterAsync();

        var order = await PlaceOrderAsync(Items(6)); // 600, free delivery

        order.WalletAmountApplied.ShouldBe(0m);
        order.AmountPaid.ShouldBe(0m);
        order.PaymentMethod.ShouldBe("Cashfree");
        order.PaymentSessionId.ShouldNotBeNullOrWhiteSpace();
    }

    [Fact]
    public async Task PartialBalance_IsSpentFirstAndOnlyTheRemainderGoesToTheGateway()
    {
        await SeedDeliveryChargesAsync();
        await RegisterAsync();
        await SeedWalletAsync(200m);

        var order = await PlaceOrderAsync(Items(6)); // 600

        order.WalletAmountApplied.ShouldBe(200m);
        order.AmountPaid.ShouldBe(200m);
        // Still a gateway payment for what's left, so the order isn't settled yet.
        order.PaymentMethod.ShouldBe("Cashfree");
        order.PaymentStatus.ShouldBe("Pending");
        order.PaymentSessionId.ShouldNotBeNullOrWhiteSpace();
        (await GetWalletAsync()).Balance.ShouldBe(0m);
    }

    [Fact]
    public async Task ABalanceCoveringTheWholeTotal_SettlesTheOrderWithNoGatewayPaymentAtAll()
    {
        await SeedDeliveryChargesAsync();
        await RegisterAsync();
        await SeedWalletAsync(1000m);

        var order = await PlaceOrderAsync(Items(6)); // 600

        order.WalletAmountApplied.ShouldBe(600m);
        order.AmountPaid.ShouldBe(600m);
        order.PaymentMethod.ShouldBe("Wallet");
        order.PaymentStatus.ShouldBe("Paid");
        // Nothing to pay, so no hosted checkout page is ever opened.
        order.PaymentSessionId.ShouldBeNull();
        (await GetWalletAsync()).Balance.ShouldBe(400m);
    }

    [Fact]
    public async Task OptingOutOfTheWallet_LeavesTheBalanceUntouched()
    {
        await SeedDeliveryChargesAsync();
        await RegisterAsync();
        await SeedWalletAsync(1000m);

        var order = await PlaceOrderAsync(Items(6), useWallet: false);

        order.WalletAmountApplied.ShouldBe(0m);
        order.PaymentMethod.ShouldBe("Cashfree");
        (await GetWalletAsync()).Balance.ShouldBe(1000m);
    }

    [Fact]
    public async Task SpendingBalance_IsRecordedInTheLedger()
    {
        await SeedDeliveryChargesAsync();
        await RegisterAsync();
        await SeedWalletAsync(200m);

        var order = await PlaceOrderAsync(Items(6));

        var entry = (await GetWalletAsync()).Transactions.ShouldHaveSingleItem();
        entry.Amount.ShouldBe(-200m); // Signed: a debit.
        entry.BalanceAfter.ShouldBe(0m);
        entry.Reason.ShouldBe(WalletTransactionReasons.OrderPayment);
        entry.OrderId.ShouldBe(order.Id);
    }

    // ---------- refunds on cancellation ----------

    [Fact]
    public async Task CancellingWithWalletChosen_CreditsTheBalanceImmediately()
    {
        await SeedDeliveryChargesAsync();
        await RegisterAsync();
        var order = await PlaceOrderAsync(Items(6));
        await MarkPaidAsync(order.Id, 600m);

        var result = await CancelAsync(order.Id, RefundDestinations.Wallet);

        result.WalletCredited.ShouldBe(600m);
        result.SourceRefundQueued.ShouldBe(0m);
        (await GetWalletAsync()).Balance.ShouldBe(600m);
    }

    [Fact]
    public async Task CancellingWithOriginalPaymentModeChosen_QueuesForAnAdminInsteadOfPayingOut()
    {
        await SeedDeliveryChargesAsync();
        await RegisterAsync();
        var order = await PlaceOrderAsync(Items(6));
        await MarkPaidAsync(order.Id, 600m);

        var result = await CancelAsync(order.Id, RefundDestinations.Source);

        result.SourceRefundQueued.ShouldBe(600m);
        result.WalletCredited.ShouldBe(0m);
        // Real money, so nothing moves until a human confirms it.
        (await GetWalletAsync()).Balance.ShouldBe(0m);

        var orders = await _client.GetFromJsonAsync<List<OrderResponse>>("/api/orders/my");
        orders!.Single(o => o.Id == order.Id).RefundPendingAmount.ShouldBe(600m);
    }

    [Fact]
    public async Task TheWalletFundedShareAlwaysReturnsToTheWallet_EvenWhenSourceRefundIsChosen()
    {
        await SeedDeliveryChargesAsync();
        await RegisterAsync();
        await SeedWalletAsync(200m);
        var order = await PlaceOrderAsync(Items(6)); // 600: 200 wallet + 400 gateway
        await MarkPaidAsync(order.Id, 600m);

        var result = await CancelAsync(order.Id, RefundDestinations.Source);

        // Store credit can't be refunded to a card, so it goes back where it came from.
        result.WalletCredited.ShouldBe(200m);
        result.SourceRefundQueued.ShouldBe(400m);
        (await GetWalletAsync()).Balance.ShouldBe(200m);
    }

    [Fact]
    public async Task CancellingAnUnpaidOrder_RefundsNothing()
    {
        await SeedDeliveryChargesAsync();
        await RegisterAsync();
        var order = await PlaceOrderAsync(Items(6));

        var result = await CancelAsync(order.Id, RefundDestinations.Wallet);

        result.WalletCredited.ShouldBe(0m);
        result.SourceRefundQueued.ShouldBe(0m);
        (await GetWalletAsync()).Balance.ShouldBe(0m);
    }

    /// <summary>
    /// The attack: fire several cancellations at once. Checking the status with a read and then
    /// writing it afterwards let every one of them pass the check before any had written, so each
    /// credited the wallet and each put the stock back — a customer could be refunded as many
    /// times over as they had parallel requests. The claim to cancel has to be the write itself.
    /// </summary>
    [Fact]
    public async Task CancellingManyTimesAtOnce_RefundsExactlyOnce()
    {
        await SeedDeliveryChargesAsync();
        await RegisterAsync();
        await SeedWalletAsync(1000m);
        var order = await PlaceOrderAsync(Items(6)); // 600, fully covered by wallet
        order.AmountPaid.ShouldBe(600m);
        (await GetWalletAsync()).Balance.ShouldBe(400m);

        // Ten at once, all valid, all from the real customer's own session.
        var cancels = Enumerable.Range(0, 10)
            .Select(_ => _client.SendAsync(CancelRequest(order.Id)))
            .ToArray();
        await Task.WhenAll(cancels);
        foreach (var response in cancels)
            response.Result.StatusCode.ShouldBe(HttpStatusCode.OK);

        // Refunded once: the 400 left over plus the 600 the order held. Not 400 + 6000.
        (await GetWalletAsync()).Balance.ShouldBe(1000m);

        var credits = (await GetWalletAsync()).Transactions
            .Count(t => t.OrderId == order.Id && t.Amount > 0);
        credits.ShouldBe(1);
    }

    /// <summary>The same race seen from the shelf: ten cancellations must not put the goods back
    /// ten times over, which would invent stock that was never sold.</summary>
    [Fact]
    public async Task CancellingManyTimesAtOnce_RestoresStockExactlyOnce()
    {
        await SeedDeliveryChargesAsync();
        await RegisterAsync();
        var product = await _factory.SeedProductAsync(price: 100m, stock: 20);
        var order = await PlaceOrderAsync(
            [new(product.Id!, product.Name, product.Price, product.Weight, 6)]);

        var cancels = Enumerable.Range(0, 10)
            .Select(_ => _client.SendAsync(CancelRequest(order.Id)))
            .ToArray();
        await Task.WhenAll(cancels);

        int? stock = null;
        await _factory.SeedAsync(async db =>
            stock = (await db.Products.Find(p => p.Id == product.Id).FirstOrDefaultAsync())?.StockQuantity);
        stock.ShouldBe(20);
    }

    private HttpRequestMessage CancelRequest(string orderId)
    {
        var request = new HttpRequestMessage(
            HttpMethod.Patch, $"/api/orders/my/{orderId}/cancel")
        {
            Content = JsonContent.Create(new CancelOrderRequest(RefundDestinations.Wallet)),
        };
        request.AttachCsrf(_csrf);
        return request;
    }

    [Fact]
    public async Task CancellingTwice_DoesNotCreditTheWalletTwice()
    {
        await SeedDeliveryChargesAsync();
        await RegisterAsync();
        var order = await PlaceOrderAsync(Items(6));
        await MarkPaidAsync(order.Id, 600m);

        await CancelAsync(order.Id, RefundDestinations.Wallet);
        var second = await CancelAsync(order.Id, RefundDestinations.Wallet);

        second.WalletCredited.ShouldBe(0m);
        (await GetWalletAsync()).Balance.ShouldBe(600m);
    }

    [Fact]
    public async Task AnInvalidRefundDestination_IsRejected()
    {
        await SeedDeliveryChargesAsync();
        await RegisterAsync();
        var order = await PlaceOrderAsync(Items(6));

        var request = new HttpRequestMessage(HttpMethod.Patch, $"/api/orders/my/{order.Id}/cancel")
        {
            Content = JsonContent.Create(new CancelOrderRequest("bank-account")),
        };
        request.AttachCsrf(_csrf);

        var response = await _client.SendAsync(request);

        response.StatusCode.ShouldBe(HttpStatusCode.BadRequest);
    }

    [Fact]
    public async Task TheWalletHasNoWithdrawalEndpoint_KeepingItClosedLoop()
    {
        await RegisterAsync();

        // Deliberate: a cash-out path would make this a regulated prepaid instrument.
        var request = new HttpRequestMessage(HttpMethod.Post, "/api/wallet/withdraw");
        request.AttachCsrf(_csrf);
        var response = await _client.SendAsync(request);

        response.StatusCode.ShouldBe(HttpStatusCode.NotFound);
    }
}
