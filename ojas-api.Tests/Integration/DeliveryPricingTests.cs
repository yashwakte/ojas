using System.Net;
using System.Net.Http.Json;
using OjasApi.Models;
using OjasApi.Services;
using Shouldly;

namespace OjasApi.Tests.Integration;

/// <summary>
/// Delivery used to be priced from the map pin the browser sent, which meant a crafted request
/// claiming to be standing in the warehouse got free delivery, and one claiming to be next door
/// could order from anywhere in the country. Pricing is keyed on the pincode stated in the
/// address instead — checked server-side against the admin's own list — and the pin is left as
/// navigation for the delivery partner, where lying only inconveniences the customer.
/// </summary>
[Collection(MongoCollectionFixture.Name)]
public class DeliveryPricingTests : IDisposable
{
    private readonly OjasApiFactory _factory;
    private readonly HttpClient _client;

    public DeliveryPricingTests(MongoRunnerFixture mongo)
    {
        _factory = new OjasApiFactory(mongo);
        _client = _factory.CreateClient();
    }

    public void Dispose()
    {
        _client.Dispose();
        _factory.Dispose();
    }

    // The warehouse. A pin here is what an attacker sends to claim zero distance.
    private const double WarehouseLat = 18.0;
    private const double WarehouseLng = 73.0;

    private string _csrf = string.Empty;
    private Product _product = null!;

    private async Task SetUpAsync(bool byPincode)
    {
        await _factory.SeedAsync(async db => await db.DeliveryCharges.InsertOneAsync(new DeliveryCharges
        {
            WarehouseAddress = "Test Warehouse",
            WarehouseLatitude = WarehouseLat,
            WarehouseLongitude = WarehouseLng,
            FreeDeliveryUpToKm = 0,
            PerKmChargeAfterFree = 10,
            MaxDeliveryRadiusKm = 15,
            DefaultDeliveryCharge = 40m,
            ServiceableAreas = byPincode
                ? [
                    new ServiceableArea { Pincode = "411014", Label = "Kharadi" },
                    new ServiceableArea { Pincode = "411001", Label = "Camp", Charge = 25m },
                  ]
                : [],
            IsActive = true,
        }));
        _product = await _factory.SeedProductAsync(price: 50m);
        _csrf = (await _client.RegisterAsync(fullName: "Delivery Customer")).CsrfToken;
    }

    /// <summary>Deliberately small, so the free-delivery cart threshold never masks the charge.</summary>
    private List<OrderItemDto> Items(int quantity = 2) =>
        [new(_product.Id!, _product.Name, _product.Price, _product.Weight, quantity)];

    private async Task<HttpResponseMessage> PlaceAsync(string address, double lat, double lng)
    {
        var request = new HttpRequestMessage(HttpMethod.Post, "/api/orders")
        {
            Content = JsonContent.Create(new PlaceOrderRequest(
                "Delivery Customer", "9123456789", address, lat, lng, "", Items())),
        };
        request.AttachCsrf(_csrf);
        return await _client.SendAsync(request);
    }

    // ---------- the attack ----------

    /// <summary>
    /// The exploit: a real, distant address, with the warehouse's own coordinates in the payload.
    /// Priced from the pin that bought free delivery; priced from the pincode it costs what that
    /// pincode costs, because the pin is no longer part of the sum.
    /// </summary>
    [Fact]
    public async Task ClaimingTheWarehousesOwnCoordinates_NoLongerBuysFreeDelivery()
    {
        await SetUpAsync(byPincode: true);

        var response = await PlaceAsync(
            "Flat 5, Kharadi, Pune, Maharashtra - 411014", WarehouseLat, WarehouseLng);

        response.StatusCode.ShouldBe(HttpStatusCode.OK);
        var order = (await response.Content.ReadFromJsonAsync<OrderResponse>())!;
        order.DeliveryCharge.ShouldBe(40m);
        order.TotalAmount.ShouldBe(100m + 40m);
    }

    /// <summary>The other half of the same lie: a pin just outside the door, for an address we
    /// don't serve. The pincode is what decides, so it is refused.</summary>
    [Fact]
    public async Task APinNextToTheWarehouseDoesNotBuyDeliveryToAnUnservedPincode()
    {
        await SetUpAsync(byPincode: true);

        var response = await PlaceAsync(
            "Somewhere in Mumbai - 400001", WarehouseLat, WarehouseLng);

        response.StatusCode.ShouldBe(HttpStatusCode.BadRequest);
    }

    [Fact]
    public async Task AnAddressWithNoPincodeAtAll_IsRefused()
    {
        await SetUpAsync(byPincode: true);

        var response = await PlaceAsync("Just past the big tree, Pune", WarehouseLat, WarehouseLng);

        response.StatusCode.ShouldBe(HttpStatusCode.BadRequest);
    }

    [Fact]
    public async Task APincodeWithItsOwnCharge_IsBilledThatRatherThanTheDefault()
    {
        await SetUpAsync(byPincode: true);

        var response = await PlaceAsync("MG Road, Camp, Pune - 411001", 18.9, 73.9);

        response.StatusCode.ShouldBe(HttpStatusCode.OK);
        var order = (await response.Content.ReadFromJsonAsync<OrderResponse>())!;
        order.DeliveryCharge.ShouldBe(25m);
    }

    /// <summary>Moving the pin around no longer changes the bill at all — which is the property
    /// that makes the whole class of attack pointless.</summary>
    [Fact]
    public async Task MovingThePinDoesNotChangeWhatDeliveryCosts()
    {
        await SetUpAsync(byPincode: true);
        const string address = "Flat 5, Kharadi, Pune - 411014";

        var atTheWarehouse = await PlaceAsync(address, WarehouseLat, WarehouseLng);
        var faultAcrossTown = await PlaceAsync(address, 18.09, 73.09);

        var first = (await atTheWarehouse.Content.ReadFromJsonAsync<OrderResponse>())!;
        var second = (await faultAcrossTown.Content.ReadFromJsonAsync<OrderResponse>())!;

        first.DeliveryCharge.ShouldBe(second.DeliveryCharge);
        first.DeliveryCharge.ShouldBe(40m);
    }

    /// <summary>The cart threshold still waives it, exactly as before.</summary>
    [Fact]
    public async Task ACartOverTheFreeDeliveryThreshold_StillPaysNothing()
    {
        await SetUpAsync(byPincode: true);

        var request = new HttpRequestMessage(HttpMethod.Post, "/api/orders")
        {
            Content = JsonContent.Create(new PlaceOrderRequest(
                "Delivery Customer", "9123456789", "Kharadi, Pune - 411014",
                18.05, 73.05, "", Items(20))), // 20 x 50 = 1000, over the 500 threshold
        };
        request.AttachCsrf(_csrf);
        var order = (await (await _client.SendAsync(request))
            .Content.ReadFromJsonAsync<OrderResponse>())!;

        order.DeliveryCharge.ShouldBe(0m);
    }

    /// <summary>Editing goes through the same rule, so an edit can't smuggle in a cheaper pin.</summary>
    [Fact]
    public async Task EditingAnOrder_IsPricedByPincodeToo()
    {
        await SetUpAsync(byPincode: true);
        var placed = (await (await PlaceAsync("Kharadi, Pune - 411014", 18.05, 73.05))
            .Content.ReadFromJsonAsync<OrderResponse>())!;

        var edit = new HttpRequestMessage(HttpMethod.Put, $"/api/orders/my/{placed.Id}")
        {
            // Same address, but now claiming to be at the warehouse.
            Content = JsonContent.Create(new UpdateMyOrderRequest(
                "Delivery Customer", "9123456789", "Kharadi, Pune - 411014",
                WarehouseLat, WarehouseLng, "", Items(4))),
        };
        edit.AttachCsrf(_csrf);
        var result = (await (await _client.SendAsync(edit))
            .Content.ReadFromJsonAsync<UpdateMyOrderResponse>())!;

        result.Order.DeliveryCharge.ShouldBe(40m);
    }

    // ---------- before it is configured ----------

    /// <summary>Until the admin lists any pincodes, the older distance rules still apply so an
    /// existing deployment keeps working. This is the state that is still exploitable, which is
    /// why configuring the list is a go-live step rather than an optional nicety.</summary>
    [Fact]
    public async Task WithNoPincodesConfigured_TheOlderDistanceRulesStillApply()
    {
        await SetUpAsync(byPincode: false);

        var response = await PlaceAsync("Kharadi, Pune - 411014", WarehouseLat, WarehouseLng);

        response.StatusCode.ShouldBe(HttpStatusCode.OK);
        var order = (await response.Content.ReadFromJsonAsync<OrderResponse>())!;
        order.DeliveryCharge.ShouldBe(0m); // distance zero, the very hole this replaces
    }

    // ---------- reading the pincode out of an address ----------

    [Theory]
    [InlineData("Flat 5, Anandham, Kharadi, Pune, Maharashtra - 411014", "411014")]
    [InlineData("Kharadi Pune 411014", "411014")]
    [InlineData("No pincode here", null)]
    [InlineData("", null)]
    // A ten-digit phone number contains six-digit substrings but no six-digit token.
    [InlineData("Call 9123456789, Kharadi, Pune - 411014", "411014")]
    [InlineData("Call 9123456789, Kharadi, Pune", null)]
    // Indian addresses put the pincode last, so the last token wins.
    [InlineData("Plot 411001, Kharadi, Pune - 411014", "411014")]
    public void PincodeIsReadFromTheEndOfTheAddress(string address, string? expected)
    {
        DeliveryChargesService.PincodeFrom(address).ShouldBe(expected);
    }
}
