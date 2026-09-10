using System.Net;
using System.Net.Http.Json;
using MongoDB.Driver;
using OjasApi.Models;
using Shouldly;

namespace OjasApi.Tests.Integration;

/// <summary>
/// The whole life of a return, against real MongoDB.
///
/// Returns move real money, and the rules that stop them moving too much of it live in filtered
/// updates - the status transition and the refund cap alike - which only a real database
/// enforces. A mocked collection would happily let two refunds through and report success.
/// </summary>
[Collection(MongoCollectionFixture.Name)]
public class ReturnFlowTests : IDisposable
{
    private readonly OjasApiFactory _factory;
    private readonly HttpClient _customer;
    private string _customerCsrf = string.Empty;

    public ReturnFlowTests(MongoRunnerFixture mongo)
    {
        _factory = new OjasApiFactory(mongo);
        _customer = _factory.CreateClient();
    }

    public void Dispose()
    {
        _customer.Dispose();
        _factory.Dispose();
    }

    private const double Lat = 18.0;
    private const double Lng = 73.0;

    /// <summary>An order that has been paid for and delivered - the only kind a return can be
    /// raised against.</summary>
    private async Task<(OrderResponse Order, Product Product, HttpClient Admin, string AdminCsrf)> DeliveredOrderAsync(
        decimal price = 100m, int quantity = 3)
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
        var (_, csrf) = await _customer.RegisterAsync(fullName: "Return Customer");
        _customerCsrf = csrf;

        var place = new HttpRequestMessage(HttpMethod.Post, "/api/orders")
        {
            Content = JsonContent.Create(new PlaceOrderRequest(
                "Return Customer", "9123456789", "123 Main St", Lat, Lng, "",
                [new(product.Id!, product.Name, product.Price, product.Weight, quantity)])),
        };
        place.AttachCsrf(csrf);
        var order = (await (await _customer.SendAsync(place))
            .Content.ReadFromJsonAsync<OrderResponse>())!;

        _factory.Cashfree.PayAllOutstanding();
        (await _customer.GetAsync($"/api/payments/cashfree/status/{order.Id}"))
            .StatusCode.ShouldBe(HttpStatusCode.OK);

        var admin = _factory.CreateClient();
        var (_, adminCsrf) = await _factory.SeedAndLoginAsStaffAsync(admin, UserRoles.Admin);

        var deliver = new HttpRequestMessage(HttpMethod.Patch, $"/api/orders/admin/{order.Id}/status")
        {
            Content = JsonContent.Create(new UpdateOrderStatusRequest("Delivered")),
        };
        deliver.AttachCsrf(adminCsrf);
        (await admin.SendAsync(deliver)).StatusCode.ShouldBe(HttpStatusCode.OK);

        return (order, product, admin, adminCsrf);
    }

    private HttpRequestMessage CreateReturn(
        string orderId, string productId, int quantity,
        string reason = ReturnReasons.Damaged,
        string destination = RefundDestinations.Wallet)
    {
        var request = new HttpRequestMessage(HttpMethod.Post, "/api/returns/my")
        {
            Content = JsonContent.Create(new CreateReturnRequest(
                orderId, [new ReturnItemRequest(productId, quantity)], reason, null, destination)),
        };
        request.AttachCsrf(_customerCsrf);
        return request;
    }

    private static HttpRequestMessage AdminStatus(string returnId, string status, string csrf, string? note = null)
    {
        var request = new HttpRequestMessage(HttpMethod.Patch, $"/api/returns/admin/{returnId}/status")
        {
            Content = JsonContent.Create(new UpdateReturnStatusRequest(status, note)),
        };
        request.AttachCsrf(csrf);
        return request;
    }

    [Fact]
    public async Task DeliveringAnOrder_StampsDeliveredAt_AndOpensTheReturnWindow()
    {
        var (order, _, admin, _) = await DeliveredOrderAsync();
        admin.Dispose();

        var eligibility = await _customer.GetFromJsonAsync<ReturnEligibilityResponse>(
            $"/api/returns/eligibility/{order.Id}");

        eligibility!.CanRequest.ShouldBeTrue();
        eligibility.WindowDays.ShouldBe(ReturnPolicy.WindowDays);
        eligibility.WindowEndsAt.ShouldNotBeNull();
        eligibility.Items.Single().ReturnableQuantity.ShouldBe(3);
    }

    /// <summary>
    /// The window is measured from delivery and nothing else may move it. UpdatedAt shifts every
    /// time anyone touches an order, so a deadline derived from it would slide forward each time
    /// support opened the record - which is not a deadline.
    /// </summary>
    [Fact]
    public async Task ReDeliveringAnOrder_DoesNotPushTheDeadlineOut()
    {
        var (order, _, admin, adminCsrf) = await DeliveredOrderAsync();
        using var _admin = admin;

        var first = (await _customer.GetFromJsonAsync<ReturnEligibilityResponse>(
            $"/api/returns/eligibility/{order.Id}"))!.WindowEndsAt;

        var again = new HttpRequestMessage(HttpMethod.Patch, $"/api/orders/admin/{order.Id}/status")
        {
            Content = JsonContent.Create(new UpdateOrderStatusRequest("Delivered")),
        };
        again.AttachCsrf(adminCsrf);
        await admin.SendAsync(again);

        var second = (await _customer.GetFromJsonAsync<ReturnEligibilityResponse>(
            $"/api/returns/eligibility/{order.Id}"))!.WindowEndsAt;

        second.ShouldBe(first);
    }

    [Fact]
    public async Task AnOrderThatIsNotDelivered_CannotBeReturned()
    {
        await _factory.SeedAsync(async db => await db.DeliveryCharges.InsertOneAsync(new DeliveryCharges
        {
            WarehouseAddress = "W", WarehouseLatitude = Lat, WarehouseLongitude = Lng,
            FreeDeliveryUpToKm = 5, PerKmChargeAfterFree = 10, IsActive = true,
        }));
        var product = await _factory.SeedProductAsync(price: 100m);
        var (_, csrf) = await _customer.RegisterAsync(fullName: "Undelivered");
        _customerCsrf = csrf;

        var place = new HttpRequestMessage(HttpMethod.Post, "/api/orders")
        {
            Content = JsonContent.Create(new PlaceOrderRequest(
                "Undelivered", "9123456789", "1 St", Lat, Lng, "",
                [new(product.Id!, product.Name, product.Price, product.Weight, 1)])),
        };
        place.AttachCsrf(csrf);
        var order = (await (await _customer.SendAsync(place))
            .Content.ReadFromJsonAsync<OrderResponse>())!;

        var eligibility = await _customer.GetFromJsonAsync<ReturnEligibilityResponse>(
            $"/api/returns/eligibility/{order.Id}");
        eligibility!.CanRequest.ShouldBeFalse();

        // And the endpoint refuses it too, not merely the button.
        (await _customer.SendAsync(CreateReturn(order.Id, product.Id!, 1)))
            .StatusCode.ShouldBe(HttpStatusCode.BadRequest);
    }

    /// <summary>The window is enforced by the API, not only hidden in the UI - so an old order
    /// is refused even if a request is posted straight at it.</summary>
    [Fact]
    public async Task AnOrderDeliveredBeyondTheWindow_IsRefused()
    {
        var (order, product, admin, _) = await DeliveredOrderAsync();
        admin.Dispose();

        await _factory.SeedAsync(async db => await db.Orders.UpdateOneAsync(
            o => o.Id == order.Id,
            Builders<Order>.Update.Set(o => o.DeliveredAt,
                DateTime.UtcNow.AddDays(-(ReturnPolicy.WindowDays + 2)))));

        var eligibility = await _customer.GetFromJsonAsync<ReturnEligibilityResponse>(
            $"/api/returns/eligibility/{order.Id}");
        eligibility!.CanRequest.ShouldBeFalse();
        eligibility.Reason.ShouldContain("window");

        (await _customer.SendAsync(CreateReturn(order.Id, product.Id!, 1)))
            .StatusCode.ShouldBe(HttpStatusCode.BadRequest);
    }

    /// <summary>
    /// Changing your mind is not a reason we accept. The owner removed "ordered by mistake" on
    /// 2026-09-11 - "It's their fault not ours" - so the API must refuse it rather than the form
    /// merely having stopped offering it, or anyone posting the old code straight at the endpoint
    /// would still get a return we do not honour.
    /// </summary>
    [Fact]
    public async Task AChangeOfMindIsNotAReasonTheApiAccepts()
    {
        var (order, product, admin, _) = await DeliveredOrderAsync();
        admin.Dispose();

        (await _customer.SendAsync(CreateReturn(order.Id, product.Id!, 1, reason: "OrderedByMistake")))
            .StatusCode.ShouldBe(HttpStatusCode.BadRequest);

        // It reaches us as "something else" with the customer's own words instead, for a human.
        (await _customer.SendAsync(CreateReturn(order.Id, product.Id!, 1, reason: ReturnReasons.Other)))
            .StatusCode.ShouldBe(HttpStatusCode.OK);
    }

    [Fact]
    public async Task AReturnCannotAskForMoreUnitsThanWereOrdered()
    {
        var (order, product, admin, _) = await DeliveredOrderAsync(quantity: 2);
        admin.Dispose();

        (await _customer.SendAsync(CreateReturn(order.Id, product.Id!, 5)))
            .StatusCode.ShouldBe(HttpStatusCode.BadRequest);
    }

    /// <summary>Two requests must not between them return more than was bought - the second is
    /// measured against what the first is already holding.</summary>
    [Fact]
    public async Task ASecondReturn_CannotClaimUnitsTheFirstAlreadyHolds()
    {
        var (order, product, admin, _) = await DeliveredOrderAsync(quantity: 3);
        admin.Dispose();

        (await _customer.SendAsync(CreateReturn(order.Id, product.Id!, 2)))
            .StatusCode.ShouldBe(HttpStatusCode.OK);

        (await _customer.SendAsync(CreateReturn(order.Id, product.Id!, 2)))
            .StatusCode.ShouldBe(HttpStatusCode.BadRequest);

        // One unit is still free, so this is allowed.
        (await _customer.SendAsync(CreateReturn(order.Id, product.Id!, 1)))
            .StatusCode.ShouldBe(HttpStatusCode.OK);
    }

    /// <summary>
    /// The money only moves once the goods are back. Refunding straight from Requested would make
    /// a return an unverifiable claim, which for food - where the whole condition is an unbroken
    /// seal - is a giveaway rather than a policy.
    /// </summary>
    [Fact]
    public async Task AReturnCannotBeRefundedBeforeItIsPickedUp()
    {
        var (order, product, admin, adminCsrf) = await DeliveredOrderAsync();
        using var _admin = admin;

        var created = (await (await _customer.SendAsync(CreateReturn(order.Id, product.Id!, 1)))
            .Content.ReadFromJsonAsync<ReturnRequestResponse>())!;

        (await admin.SendAsync(AdminStatus(created.Id, ReturnRequestStatuses.Refunded, adminCsrf)))
            .StatusCode.ShouldBe(HttpStatusCode.Conflict);

        var walletAfter = await WalletBalanceAsync();
        walletAfter.ShouldBe(0m);
    }

    private async Task<decimal> WalletBalanceAsync()
    {
        var wallet = await _customer.GetFromJsonAsync<WalletResponse>("/api/wallet");
        return wallet?.Balance ?? 0m;
    }

    [Fact]
    public async Task TheHappyPath_ApproveCollectRefund_CreditsTheWalletOnce()
    {
        var (order, product, admin, adminCsrf) = await DeliveredOrderAsync(price: 100m, quantity: 3);
        using var _admin = admin;

        var created = (await (await _customer.SendAsync(CreateReturn(order.Id, product.Id!, 2)))
            .Content.ReadFromJsonAsync<ReturnRequestResponse>())!;
        created.Status.ShouldBe(ReturnRequestStatuses.Requested);
        created.RefundAmount.ShouldBe(200m);

        (await admin.SendAsync(AdminStatus(created.Id, ReturnRequestStatuses.Approved, adminCsrf)))
            .StatusCode.ShouldBe(HttpStatusCode.OK);
        (await admin.SendAsync(AdminStatus(created.Id, ReturnRequestStatuses.PickedUp, adminCsrf)))
            .StatusCode.ShouldBe(HttpStatusCode.OK);

        var settled = await (await admin.SendAsync(
            AdminStatus(created.Id, ReturnRequestStatuses.Refunded, adminCsrf)))
            .Content.ReadFromJsonAsync<ReturnSettlementResponse>();

        settled!.WalletCredited.ShouldBe(200m);
        settled.Request!.Status.ShouldBe(ReturnRequestStatuses.Refunded);
        (await WalletBalanceAsync()).ShouldBe(200m);
    }

    /// <summary>Two admins pressing Refund together. The transition is claimed by a filtered
    /// update, so exactly one of them can pay the customer.</summary>
    [Fact]
    public async Task SeveralRefundsAtOnce_PayTheCustomerOnce()
    {
        var (order, product, admin, adminCsrf) = await DeliveredOrderAsync(price: 100m, quantity: 3);
        using var _admin = admin;

        var created = (await (await _customer.SendAsync(CreateReturn(order.Id, product.Id!, 2)))
            .Content.ReadFromJsonAsync<ReturnRequestResponse>())!;

        await admin.SendAsync(AdminStatus(created.Id, ReturnRequestStatuses.PickedUp, adminCsrf));

        var attempts = Enumerable.Range(0, 6)
            .Select(_ => admin.SendAsync(AdminStatus(created.Id, ReturnRequestStatuses.Refunded, adminCsrf)))
            .ToArray();
        await Task.WhenAll(attempts);

        attempts.Count(a => a.Result.StatusCode == HttpStatusCode.OK).ShouldBe(1);
        (await WalletBalanceAsync()).ShouldBe(200m);
    }

    /// <summary>A refund can never take out more than the order still holds, however the return
    /// was priced - the cap is applied against the live order at settlement.</summary>
    [Fact]
    public async Task ARefundNeverExceedsWhatTheOrderStillHolds()
    {
        var (order, product, admin, adminCsrf) = await DeliveredOrderAsync(price: 100m, quantity: 3);
        using var _admin = admin;

        // The order captured 300 for goods plus delivery. An admin refunds all but 50 of it by
        // hand first, so the return below has to make do with what is left. Read live rather than
        // from the placement response, which was written before the payment landed.
        var captured = 0m;
        await _factory.SeedAsync(async db =>
            captured = (await db.Orders.Find(o => o.Id == order.Id).FirstOrDefaultAsync())!.AmountPaid);
        captured.ShouldBeGreaterThan(50m);

        var byHand = new HttpRequestMessage(HttpMethod.Post, $"/api/orders/admin/{order.Id}/refund")
        {
            Content = JsonContent.Create(new RefundOrderRequest(captured - 50m)),
        };
        byHand.AttachCsrf(adminCsrf);
        (await admin.SendAsync(byHand)).StatusCode.ShouldBe(HttpStatusCode.OK);

        var created = (await (await _customer.SendAsync(CreateReturn(order.Id, product.Id!, 2)))
            .Content.ReadFromJsonAsync<ReturnRequestResponse>())!;
        await admin.SendAsync(AdminStatus(created.Id, ReturnRequestStatuses.PickedUp, adminCsrf));

        var settled = await (await admin.SendAsync(
            AdminStatus(created.Id, ReturnRequestStatuses.Refunded, adminCsrf)))
            .Content.ReadFromJsonAsync<ReturnSettlementResponse>();

        settled!.WalletCredited.ShouldBe(50m);
        (await WalletBalanceAsync()).ShouldBe(50m);
    }

    [Fact]
    public async Task RejectingWithoutAReason_IsRefused_AndRejectingReleasesTheItems()
    {
        var (order, product, admin, adminCsrf) = await DeliveredOrderAsync(quantity: 1);
        using var _admin = admin;

        var created = (await (await _customer.SendAsync(CreateReturn(order.Id, product.Id!, 1)))
            .Content.ReadFromJsonAsync<ReturnRequestResponse>())!;

        (await admin.SendAsync(AdminStatus(created.Id, ReturnRequestStatuses.Rejected, adminCsrf)))
            .StatusCode.ShouldBe(HttpStatusCode.BadRequest);

        (await admin.SendAsync(AdminStatus(
            created.Id, ReturnRequestStatuses.Rejected, adminCsrf, "The pack had been opened.")))
            .StatusCode.ShouldBe(HttpStatusCode.OK);

        // A refused return must give the unit back, or one wrong decision locks the customer out
        // of ever asking again.
        var eligibility = await _customer.GetFromJsonAsync<ReturnEligibilityResponse>(
            $"/api/returns/eligibility/{order.Id}");
        eligibility!.Items.Single().ReturnableQuantity.ShouldBe(1);
        (await WalletBalanceAsync()).ShouldBe(0m);
    }

    [Fact]
    public async Task ACustomerCanCancelTheirOwnReturn_ButNotOnceItIsCollected()
    {
        var (order, product, admin, adminCsrf) = await DeliveredOrderAsync(quantity: 2);
        using var _admin = admin;

        var first = (await (await _customer.SendAsync(CreateReturn(order.Id, product.Id!, 1)))
            .Content.ReadFromJsonAsync<ReturnRequestResponse>())!;

        var cancel = new HttpRequestMessage(HttpMethod.Patch, $"/api/returns/my/{first.Id}/cancel");
        cancel.AttachCsrf(_customerCsrf);
        (await _customer.SendAsync(cancel)).StatusCode.ShouldBe(HttpStatusCode.OK);

        var second = (await (await _customer.SendAsync(CreateReturn(order.Id, product.Id!, 1)))
            .Content.ReadFromJsonAsync<ReturnRequestResponse>())!;
        await admin.SendAsync(AdminStatus(second.Id, ReturnRequestStatuses.PickedUp, adminCsrf));

        var tooLate = new HttpRequestMessage(HttpMethod.Patch, $"/api/returns/my/{second.Id}/cancel");
        tooLate.AttachCsrf(_customerCsrf);
        (await _customer.SendAsync(tooLate)).StatusCode.ShouldBe(HttpStatusCode.BadRequest);
    }

    /// <summary>A return is as private as the order behind it, and another customer's must be
    /// indistinguishable from one that does not exist.</summary>
    [Fact]
    public async Task AnotherCustomersOrderCannotBeReturnedOrInspected()
    {
        var (order, product, admin, _) = await DeliveredOrderAsync();
        admin.Dispose();

        using var stranger = _factory.CreateClient();
        var (_, strangerCsrf) = await stranger.RegisterAsync(fullName: "Stranger", email: "stranger@example.com");

        (await stranger.GetAsync($"/api/returns/eligibility/{order.Id}"))
            .StatusCode.ShouldBe(HttpStatusCode.NotFound);

        var attempt = new HttpRequestMessage(HttpMethod.Post, "/api/returns/my")
        {
            Content = JsonContent.Create(new CreateReturnRequest(
                order.Id, [new ReturnItemRequest(product.Id!, 1)], ReturnReasons.Damaged)),
        };
        attempt.AttachCsrf(strangerCsrf);
        (await stranger.SendAsync(attempt)).StatusCode.ShouldBe(HttpStatusCode.BadRequest);

        (await stranger.GetFromJsonAsync<List<ReturnRequestResponse>>("/api/returns/my"))!
            .ShouldBeEmpty();
    }

    /// <summary>The queue is admin-only. A customer reaching it would see every other customer's
    /// name, phone number and address.</summary>
    [Fact]
    public async Task TheAdminQueueIsClosedToCustomers()
    {
        var (_, _, admin, _) = await DeliveredOrderAsync();
        admin.Dispose();

        (await _customer.GetAsync("/api/returns/admin/all"))
            .StatusCode.ShouldBeOneOf(HttpStatusCode.Forbidden, HttpStatusCode.Unauthorized);
    }

    /// <summary>A customer's own read must not carry the identifying fields the queue needs.</summary>
    [Fact]
    public async Task ACustomersOwnReturnsDoNotCarryPickupDetails()
    {
        var (order, product, admin, _) = await DeliveredOrderAsync();
        admin.Dispose();

        await _customer.SendAsync(CreateReturn(order.Id, product.Id!, 1));

        var mine = (await _customer.GetFromJsonAsync<List<ReturnRequestResponse>>("/api/returns/my"))!;
        var only = mine.ShouldHaveSingleItem();
        only.CustomerPhone.ShouldBeNull();
        only.PickupAddress.ShouldBeNull();
    }
}
