using System.Net;
using System.Net.Http.Json;
using MongoDB.Bson;
using MongoDB.Driver;
using OjasApi.Models;
using OjasApi.Services;
using Shouldly;

namespace OjasApi.Tests.Integration;

/// <summary>
/// The server-side cart: what a customer puts in their basket on one device is what they find on
/// the next. Before this the basket lived only in the browser, so signing in on a second device
/// showed an empty cart.
/// </summary>
[Collection(MongoCollectionFixture.Name)]
public class CartTests : IDisposable
{
    private const string Password = "Passw0rd123!";

    private readonly OjasApiFactory _factory;
    private readonly HttpClient _client;

    public CartTests(MongoRunnerFixture mongo)
    {
        _factory = new OjasApiFactory(mongo);
        _client = _factory.CreateClient();
    }

    public void Dispose()
    {
        _client.Dispose();
        _factory.Dispose();
    }

    private static async Task<HttpResponseMessage> PutAsync(
        HttpClient client, string? csrf, string list, params CartLineRequest[] lines)
    {
        var request = new HttpRequestMessage(HttpMethod.Put, $"/api/cart/{list}")
        {
            Content = JsonContent.Create(new ReplaceCartLinesRequest([.. lines])),
        };
        if (csrf != null) request.AttachCsrf(csrf);
        return await client.SendAsync(request);
    }

    private static async Task<CartResponse> GetCartAsync(HttpClient client)
    {
        var response = await client.GetAsync("/api/cart");
        response.StatusCode.ShouldBe(HttpStatusCode.OK);
        return (await response.Content.ReadFromJsonAsync<CartResponse>())!;
    }

    [Fact]
    public async Task A_new_account_starts_with_an_empty_cart()
    {
        await _client.RegisterAsync();

        var cart = await GetCartAsync(_client);

        cart.Items.ShouldBeEmpty();
        cart.CheckoutItems.ShouldBeEmpty();
    }

    [Fact]
    public async Task A_cart_saved_on_one_device_is_there_when_signing_in_on_another()
    {
        var (auth, csrf) = await _client.RegisterAsync();
        var product = await _factory.SeedProductAsync(price: 120m, name: "Jowar Flour");

        (await PutAsync(_client, csrf, "items", new CartLineRequest(product.Id!, 3)))
            .StatusCode.ShouldBe(HttpStatusCode.NoContent);

        using var otherDevice = _factory.CreateClient();
        await otherDevice.LoginAsync(auth.Email, Password);
        var cart = await GetCartAsync(otherDevice);

        cart.Items.Count.ShouldBe(1);
        cart.Items[0].Product.Id.ShouldBe(product.Id);
        cart.Items[0].Product.Name.ShouldBe("Jowar Flour");
        cart.Items[0].Quantity.ShouldBe(3);
    }

    [Fact]
    public async Task The_cart_and_the_checkout_selection_are_saved_without_overwriting_each_other()
    {
        var (_, csrf) = await _client.RegisterAsync();
        var inCart = await _factory.SeedProductAsync(name: "In the cart");
        var atCheckout = await _factory.SeedProductAsync(name: "At checkout");

        await PutAsync(_client, csrf, "items", new CartLineRequest(inCart.Id!, 2));
        await PutAsync(_client, csrf, "checkout", new CartLineRequest(atCheckout.Id!, 1));

        var cart = await GetCartAsync(_client);
        cart.Items.Select(i => i.Product.Name).ShouldBe(["In the cart"]);
        cart.CheckoutItems.Select(i => i.Product.Name).ShouldBe(["At checkout"]);

        // Emptying one list - what placing an order does to checkout - leaves the other alone.
        await PutAsync(_client, csrf, "checkout");
        cart = await GetCartAsync(_client);
        cart.CheckoutItems.ShouldBeEmpty();
        cart.Items.Count.ShouldBe(1);
    }

    [Fact]
    public async Task Lines_are_cleaned_up_before_they_are_stored()
    {
        var (_, csrf) = await _client.RegisterAsync();
        var zero = await _factory.SeedProductAsync(name: "Zero quantity");
        var huge = await _factory.SeedProductAsync(name: "Huge quantity");
        var twice = await _factory.SeedProductAsync(name: "Listed twice");

        await PutAsync(_client, csrf, "items",
            new CartLineRequest("not-an-object-id", 2),
            new CartLineRequest(zero.Id!, 0),
            new CartLineRequest(huge.Id!, 500),
            new CartLineRequest(twice.Id!, 1),
            new CartLineRequest(twice.Id!, 2));

        var cart = await GetCartAsync(_client);

        cart.Items.Select(i => (i.Product.Name, i.Quantity)).ShouldBe([
            ("Huge quantity", 100),
            ("Listed twice", 2),
        ]);
    }

    [Fact]
    public async Task A_product_taken_off_sale_drops_out_of_the_cart_and_comes_back_when_relisted()
    {
        var (_, csrf) = await _client.RegisterAsync();
        var product = await _factory.SeedProductAsync(name: "Seasonal Flour");
        await PutAsync(_client, csrf, "items", new CartLineRequest(product.Id!, 1));

        await SetListedAsync(product.Id!, false);
        (await GetCartAsync(_client)).Items.ShouldBeEmpty();

        await SetListedAsync(product.Id!, true);
        (await GetCartAsync(_client)).Items.Single().Product.Name.ShouldBe("Seasonal Flour");
    }

    [Fact]
    public async Task A_deleted_product_is_left_out_rather_than_returned_half_empty()
    {
        var (_, csrf) = await _client.RegisterAsync();
        var kept = await _factory.SeedProductAsync(name: "Still sold");

        await PutAsync(_client, csrf, "items",
            new CartLineRequest(ObjectId.GenerateNewId().ToString(), 1),
            new CartLineRequest(kept.Id!, 1));

        (await GetCartAsync(_client)).Items.Select(i => i.Product.Name).ShouldBe(["Still sold"]);
    }

    [Fact]
    public async Task One_account_never_sees_another_accounts_cart()
    {
        var (_, csrf) = await _client.RegisterAsync();
        var product = await _factory.SeedProductAsync();
        await PutAsync(_client, csrf, "items", new CartLineRequest(product.Id!, 4));

        using var someoneElse = _factory.CreateClient();
        await someoneElse.RegisterAsync();

        (await GetCartAsync(someoneElse)).Items.ShouldBeEmpty();
    }

    [Fact]
    public async Task A_list_longer_than_any_real_basket_is_refused()
    {
        var (_, csrf) = await _client.RegisterAsync();
        var lines = Enumerable.Range(0, CartService.MaxLines + 1)
            .Select(_ => new CartLineRequest(ObjectId.GenerateNewId().ToString(), 1))
            .ToArray();

        (await PutAsync(_client, csrf, "items", lines)).StatusCode.ShouldBe(HttpStatusCode.BadRequest);
    }

    [Fact]
    public async Task Saving_the_cart_needs_the_csrf_token_like_every_other_write()
    {
        await _client.RegisterAsync();
        var product = await _factory.SeedProductAsync();

        (await PutAsync(_client, csrf: null, "items", new CartLineRequest(product.Id!, 1)))
            .StatusCode.ShouldBe(HttpStatusCode.Forbidden);
    }

    [Fact]
    public async Task A_signed_out_caller_has_no_cart_to_read()
    {
        (await _client.GetAsync("/api/cart")).StatusCode.ShouldBe(HttpStatusCode.Unauthorized);
    }

    [Fact]
    public async Task A_cart_carrying_a_field_this_build_does_not_know_still_loads()
    {
        // What a rollback looks like: a newer build added a field to carts, and this one has to
        // go on reading them rather than failing every customer's cart.
        var (auth, _) = await _client.RegisterAsync();
        var product = await _factory.SeedProductAsync(name: "From a newer build");
        await _factory.SeedAsync(db => db.Carts.Database.GetCollection<BsonDocument>("carts").InsertOneAsync(
            new BsonDocument
            {
                { "_id", auth.Id },
                { "items", new BsonArray { new BsonDocument { { "productId", product.Id }, { "quantity", 2 }, { "note", "gift" } } } },
                { "checkoutItems", new BsonArray() },
                { "updatedAt", DateTime.UtcNow },
                { "fieldFromTheFuture", "anything" },
            }));

        var cart = await GetCartAsync(_client);

        cart.Items.Single().Product.Name.ShouldBe("From a newer build");
        cart.Items.Single().Quantity.ShouldBe(2);
    }

    private Task SetListedAsync(string productId, bool listed) =>
        _factory.SeedAsync(db => db.Products.UpdateOneAsync(
            p => p.Id == productId,
            Builders<Product>.Update.Set(p => p.IsListed, listed)));
}
