using System.Net;
using System.Net.Http.Json;
using MongoDB.Driver;
using OjasApi.Models;
using Shouldly;

namespace OjasApi.Tests.Integration;

/// <summary>
/// The scripted support bot: every answer comes from live data (orders, products, delivery
/// charges) or a small set of fixed, business-approved strings - never from an LLM, and never
/// from anything the bot can't actually back up. Every request names a topic directly (as a
/// quick-reply click would), since there's no free-text input to guess a topic from.
/// </summary>
[Collection(MongoCollectionFixture.Name)]
public class ChatbotTests : IDisposable
{
    private readonly OjasApiFactory _factory;

    public ChatbotTests(MongoRunnerFixture mongo)
    {
        _factory = new OjasApiFactory(mongo);
    }

    public void Dispose() => _factory.Dispose();

    // A logged-in client must attach the CSRF header on this POST like any other - only
    // anonymous requests skip that check (see Program.cs's CSRF middleware).
    private static async Task<HttpResponseMessage> AskAsync(HttpClient client, string? topic = null, string? csrf = null)
    {
        var request = new HttpRequestMessage(HttpMethod.Post, "/api/chatbot/ask")
        {
            Content = JsonContent.Create(new ChatbotRequest(topic)),
        };
        if (csrf != null) request.AttachCsrf(csrf);
        return await client.SendAsync(request);
    }

    [Fact]
    public async Task RequiresNoAuthentication()
    {
        using var client = _factory.CreateClient();

        var response = await AskAsync(client, topic: ChatbotTopics.DeliveryCharge);

        response.StatusCode.ShouldNotBe(HttpStatusCode.Unauthorized);
        response.StatusCode.ShouldNotBe(HttpStatusCode.Forbidden);
    }

    [Fact]
    public async Task NoTopic_ReturnsAGreeting_WithTheMainMenu()
    {
        using var client = _factory.CreateClient();

        var response = await AskAsync(client);
        var body = await response.Content.ReadFromJsonAsync<ChatbotResponse>();

        body!.Reply.ShouldContain("Ojas assistant");
        body.QuickReplies.ShouldNotBeEmpty();
        body.Escalate.ShouldBeFalse();
    }

    [Fact]
    public async Task DeliveryChargeTopic_AnswersFromTheLiveConfig()
    {
        await _factory.SeedAsync(async db => await db.DeliveryCharges.InsertOneAsync(new DeliveryCharges
        {
            WarehouseAddress = "Test Warehouse",
            WarehouseLatitude = 18.0,
            WarehouseLongitude = 73.0,
            FreeDeliveryUpToKm = 5,
            PerKmChargeAfterFree = 12,
            MaxDeliveryRadiusKm = 20,
            IsActive = true,
        }));
        using var client = _factory.CreateClient();

        var response = await AskAsync(client, topic: ChatbotTopics.DeliveryCharge);
        var body = await response.Content.ReadFromJsonAsync<ChatbotResponse>();

        body!.Reply.ShouldContain("free within 5");
        body.Reply.ShouldContain("12");
        body.Reply.ShouldContain("20");
    }

    [Fact]
    public async Task DeliveryChargeTopic_WithNoConfig_EscalatesInsteadOfGuessing()
    {
        using var client = _factory.CreateClient();

        var response = await AskAsync(client, topic: ChatbotTopics.DeliveryCharge);
        var body = await response.Content.ReadFromJsonAsync<ChatbotResponse>();

        body!.Escalate.ShouldBeTrue();
    }

    [Fact]
    public async Task StockTopic_ListsEveryProductAsItsOwnQuickReply()
    {
        await _factory.SeedAsync(async db =>
        {
            await db.Products.InsertOneAsync(new Product
            {
                Name = "Jowar Flour", Description = "Test", Category = "Flour", Weight = "1kg", IsAvailable = true,
            });
            await db.Products.InsertOneAsync(new Product
            {
                Name = "Ragi Flour", Description = "Test", Category = "Flour", Weight = "1kg", IsAvailable = true,
            });
        });
        using var client = _factory.CreateClient();

        var response = await AskAsync(client, topic: ChatbotTopics.Stock);
        var body = await response.Content.ReadFromJsonAsync<ChatbotResponse>();

        body!.Reply.ShouldContain("Which product");
        body.QuickReplies.ShouldContain(qr => qr.Label == "Jowar Flour" && qr.Topic.StartsWith("stock:"));
        body.QuickReplies.ShouldContain(qr => qr.Label == "Ragi Flour" && qr.Topic.StartsWith("stock:"));
    }

    [Fact]
    public async Task StockTopic_ForATrackedProduct_ReportsTheRealCount()
    {
        string? productId = null;
        await _factory.SeedAsync(async db =>
        {
            var product = new Product
            {
                Name = "Jowar Flour", Description = "Test", Category = "Flour", Weight = "1kg",
                IsAvailable = true, StockQuantity = 7,
            };
            await db.Products.InsertOneAsync(product);
            productId = product.Id;
        });
        using var client = _factory.CreateClient();

        var response = await AskAsync(client, topic: $"stock:{productId}");
        var body = await response.Content.ReadFromJsonAsync<ChatbotResponse>();

        body!.Reply.ShouldContain("Jowar Flour");
        body.Reply.ShouldContain("7 left");
    }

    [Fact]
    public async Task StockTopic_ForAnUnavailableProduct_SaysUnavailable()
    {
        string? productId = null;
        await _factory.SeedAsync(async db =>
        {
            var product = new Product
            {
                Name = "Ragi Flour", Description = "Test", Category = "Flour", Weight = "1kg", IsAvailable = false,
            };
            await db.Products.InsertOneAsync(product);
            productId = product.Id;
        });
        using var client = _factory.CreateClient();

        var response = await AskAsync(client, topic: $"stock:{productId}");
        var body = await response.Content.ReadFromJsonAsync<ChatbotResponse>();

        body!.Reply.ShouldContain("unavailable");
    }

    [Fact]
    public async Task StockTopic_ForADeletedProduct_FallsBackToTheMenuInsteadOfCrashing()
    {
        using var client = _factory.CreateClient();

        var response = await AskAsync(client, topic: "stock:000000000000000000000000");
        var body = await response.Content.ReadFromJsonAsync<ChatbotResponse>();

        body!.Reply.ShouldContain("isn't listed anymore");
        body.QuickReplies.ShouldNotBeEmpty();
    }

    [Fact]
    public async Task OrderStatusTopic_WhenLoggedOut_AsksToLogInRatherThanGuessing()
    {
        using var client = _factory.CreateClient();

        var response = await AskAsync(client, topic: ChatbotTopics.OrderStatus);
        var body = await response.Content.ReadFromJsonAsync<ChatbotResponse>();

        body!.Reply.ShouldContain("log in");
    }

    [Fact]
    public async Task OrderStatusTopic_ForALoggedInCustomerWithNoOrders_SaysSo()
    {
        using var client = _factory.CreateClient();
        var (_, csrf) = await client.RegisterAsync();

        var response = await AskAsync(client, topic: ChatbotTopics.OrderStatus, csrf: csrf);
        var body = await response.Content.ReadFromJsonAsync<ChatbotResponse>();

        body!.Reply.ShouldContain("don't see any orders");
    }

    [Fact]
    public async Task OrderStatusTopic_ReturnsTheMostRecentOrdersStatus()
    {
        await _factory.SeedAsync(async db => await db.DeliveryCharges.InsertOneAsync(new DeliveryCharges
        {
            WarehouseAddress = "Test Warehouse",
            WarehouseLatitude = 18.0,
            WarehouseLongitude = 73.0,
            FreeDeliveryUpToKm = 50,
            PerKmChargeAfterFree = 10,
            IsActive = true,
        }));
        using var client = _factory.CreateClient();
        var (_, csrf) = await client.RegisterAsync();

        // Priced from the catalog server-side, so the product has to actually be in it.
        var product = await _factory.SeedProductAsync(price: 100m);
        var items = new List<OrderItemDto>
        {
            new(product.Id!, product.Name, product.Price, product.Weight, 1),
        };
        var placeRequest = new PlaceOrderRequest("Test Customer", "9123456789", "123 Main St", 18.01, 73.0, "", items);
        var placeHttpRequest = new HttpRequestMessage(HttpMethod.Post, "/api/orders") { Content = JsonContent.Create(placeRequest) };
        placeHttpRequest.AttachCsrf(csrf);
        await client.SendAsync(placeHttpRequest);

        var response = await AskAsync(client, topic: ChatbotTopics.OrderStatus, csrf: csrf);
        var body = await response.Content.ReadFromJsonAsync<ChatbotResponse>();

        body!.Reply.ShouldContain("Pending");
    }

    [Fact]
    public async Task PolicyTopic_StatesTheConfirmedPolicy()
    {
        using var client = _factory.CreateClient();

        var response = await AskAsync(client, topic: ChatbotTopics.Policy);
        var body = await response.Content.ReadFromJsonAsync<ChatbotResponse>();

        body!.Reply.ShouldContain("before it's packed");
        body.Reply.ShouldContain("check every item");
        body.Reply.ShouldContain("no longer be cancelled");
    }

    [Fact]
    public async Task HumanTopic_ReturnsRealContactDetails_AndEscalates()
    {
        using var client = _factory.CreateClient();

        var response = await AskAsync(client, topic: ChatbotTopics.Human);
        var body = await response.Content.ReadFromJsonAsync<ChatbotResponse>();

        body!.Reply.ShouldContain("8657781526");
        body.Reply.ShouldContain("wecare@ojasaata.com");
        body.Escalate.ShouldBeTrue();
    }

    [Fact]
    public async Task AnUnrecognisedTopic_FallsBackToTheMenu()
    {
        using var client = _factory.CreateClient();

        var response = await AskAsync(client, topic: "not-a-real-topic");
        var body = await response.Content.ReadFromJsonAsync<ChatbotResponse>();

        body!.Escalate.ShouldBeTrue();
        body.QuickReplies.ShouldNotBeEmpty();
    }
}
