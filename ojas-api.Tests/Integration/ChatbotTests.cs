using System.Net;
using System.Net.Http.Json;
using OjasApi.Models;
using Shouldly;

namespace OjasApi.Tests.Integration;

/// <summary>
/// The scripted support bot: every answer comes from live data (orders, products, delivery
/// charges) or a small set of fixed, business-approved strings - never from an LLM, and never
/// from anything the bot can't actually back up.
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
    private static async Task<HttpResponseMessage> AskAsync(
        HttpClient client, string? message = null, string? topic = null, string? csrf = null)
    {
        var request = new HttpRequestMessage(HttpMethod.Post, "/api/chatbot/ask")
        {
            Content = JsonContent.Create(new ChatbotRequest(message, topic)),
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
    public async Task EmptyMessage_ReturnsAGreeting_WithTheMainMenu()
    {
        using var client = _factory.CreateClient();

        var response = await AskAsync(client, message: "");
        var body = await response.Content.ReadFromJsonAsync<ChatbotResponse>();

        body!.Reply.ShouldContain("Ojas assistant");
        body.QuickReplies.ShouldNotBeEmpty();
        body.Escalate.ShouldBeFalse();
    }

    [Theory]
    [InlineData("What's the delivery fee?")]
    [InlineData("What's your delivery charge?")]
    public async Task DeliveryChargeQuestion_AnswersFromTheLiveConfig(string message)
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

        var response = await AskAsync(client, message: message);
        var body = await response.Content.ReadFromJsonAsync<ChatbotResponse>();

        body!.Reply.ShouldContain("free within 5");
        body.Reply.ShouldContain("12");
        body.Reply.ShouldContain("20");
    }

    [Fact]
    public async Task DeliveryChargeQuestion_WithNoConfig_EscalatesInsteadOfGuessing()
    {
        using var client = _factory.CreateClient();

        var response = await AskAsync(client, topic: ChatbotTopics.DeliveryCharge);
        var body = await response.Content.ReadFromJsonAsync<ChatbotResponse>();

        body!.Escalate.ShouldBeTrue();
    }

    [Fact]
    public async Task StockQuestion_WithNoProductNamed_AsksWhichOne()
    {
        using var client = _factory.CreateClient();

        var response = await AskAsync(client, topic: ChatbotTopics.Stock);
        var body = await response.Content.ReadFromJsonAsync<ChatbotResponse>();

        body!.Reply.ShouldContain("which product");
    }

    [Fact]
    public async Task StockQuestion_ForATrackedProduct_ReportsTheRealCount()
    {
        await _factory.SeedAsync(async db => await db.Products.InsertOneAsync(new Product
        {
            Name = "Jowar Flour",
            Description = "Test product",
            Category = "Flour",
            Weight = "1kg",
            IsAvailable = true,
            StockQuantity = 7,
        }));
        using var client = _factory.CreateClient();

        var response = await AskAsync(client, topic: ChatbotTopics.Stock, message: "Jowar Flour");
        var body = await response.Content.ReadFromJsonAsync<ChatbotResponse>();

        body!.Reply.ShouldContain("Jowar Flour");
        body.Reply.ShouldContain("7 left");
    }

    [Fact]
    public async Task StockQuestion_ForAnUntrackedOutOfStockProduct_SaysUnavailable()
    {
        await _factory.SeedAsync(async db => await db.Products.InsertOneAsync(new Product
        {
            Name = "Ragi Flour",
            Description = "Test product",
            Category = "Flour",
            Weight = "1kg",
            IsAvailable = false,
        }));
        using var client = _factory.CreateClient();

        var response = await AskAsync(client, topic: ChatbotTopics.Stock, message: "Ragi Flour");
        var body = await response.Content.ReadFromJsonAsync<ChatbotResponse>();

        body!.Reply.ShouldContain("unavailable");
    }

    [Fact]
    public async Task StockQuestion_ForAnUnknownProduct_DoesNotClaimAnAnswer()
    {
        using var client = _factory.CreateClient();

        var response = await AskAsync(client, topic: ChatbotTopics.Stock, message: "Definitely Not A Real Product");
        var body = await response.Content.ReadFromJsonAsync<ChatbotResponse>();

        body!.Reply.ShouldContain("couldn't find");
    }

    [Fact]
    public async Task OrderStatusQuestion_WhenLoggedOut_AsksToLogInRatherThanGuessing()
    {
        using var client = _factory.CreateClient();

        var response = await AskAsync(client, topic: ChatbotTopics.OrderStatus);
        var body = await response.Content.ReadFromJsonAsync<ChatbotResponse>();

        body!.Reply.ShouldContain("log in");
    }

    [Fact]
    public async Task OrderStatusQuestion_ForALoggedInCustomerWithNoOrders_SaysSo()
    {
        using var client = _factory.CreateClient();
        var (_, csrf) = await client.RegisterAsync();

        var response = await AskAsync(client, topic: ChatbotTopics.OrderStatus, csrf: csrf);
        var body = await response.Content.ReadFromJsonAsync<ChatbotResponse>();

        body!.Reply.ShouldContain("don't see any orders");
    }

    [Fact]
    public async Task OrderStatusQuestion_ReturnsTheMostRecentOrdersStatus()
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

        var items = new List<OrderItemDto> { new("p1", "Product One", 100, "1kg", 1) };
        var placeRequest = new PlaceOrderRequest("Test Customer", "9123456789", "123 Main St", 18.01, 73.0, "", items);
        var placeHttpRequest = new HttpRequestMessage(HttpMethod.Post, "/api/orders") { Content = JsonContent.Create(placeRequest) };
        placeHttpRequest.AttachCsrf(csrf);
        await client.SendAsync(placeHttpRequest);

        var response = await AskAsync(client, topic: ChatbotTopics.OrderStatus, csrf: csrf);
        var body = await response.Content.ReadFromJsonAsync<ChatbotResponse>();

        body!.Reply.ShouldContain("Pending");
    }

    [Theory]
    [InlineData("I need to cancel my order")]
    [InlineData("My item arrived damaged")]
    [InlineData("Can I get a refund?")]
    public async Task CancellationOrDamageQuestions_StateTheConfirmedPolicy(string message)
    {
        using var client = _factory.CreateClient();

        var response = await AskAsync(client, message: message);
        var body = await response.Content.ReadFromJsonAsync<ChatbotResponse>();

        body!.Reply.ShouldContain("before it's packed");
        body.Reply.ShouldContain("check every item");
        body.Reply.ShouldContain("no longer be cancelled");
    }

    [Fact]
    public async Task HumanHandoffRequest_ReturnsRealContactDetails_AndEscalates()
    {
        using var client = _factory.CreateClient();

        var response = await AskAsync(client, message: "I want to talk to a real person");
        var body = await response.Content.ReadFromJsonAsync<ChatbotResponse>();

        body!.Reply.ShouldContain("8657781526");
        body.Reply.ShouldContain("ashamarketingpune@gmail.com");
        body.Escalate.ShouldBeTrue();
    }

    [Fact]
    public async Task UnrecognisedMessage_FallsBackToTheMenuInsteadOfGuessingAnAnswer()
    {
        using var client = _factory.CreateClient();

        var response = await AskAsync(client, message: "asdkjfhaslkdjfhqwoeiruqwoe");
        var body = await response.Content.ReadFromJsonAsync<ChatbotResponse>();

        body!.Escalate.ShouldBeTrue();
        body.QuickReplies.ShouldNotBeEmpty();
    }

    [Fact]
    public async Task AnExplicitTopic_IsTrustedDirectly_WithoutReDetectingFromMessage()
    {
        using var client = _factory.CreateClient();

        // The message text alone wouldn't match any keyword, but an explicit Topic (as a
        // quick-reply click would send) must still win.
        var response = await AskAsync(client, topic: ChatbotTopics.Human, message: "xyz");
        var body = await response.Content.ReadFromJsonAsync<ChatbotResponse>();

        body!.Reply.ShouldContain("8657781526");
    }
}
