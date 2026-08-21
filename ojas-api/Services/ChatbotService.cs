using System.Security.Claims;
using OjasApi.Models;

namespace OjasApi.Services;

/// <summary>
/// A deliberately scripted (not LLM-backed) support bot: every answer comes from live data via
/// the existing read-only service methods, or from a small set of fixed, human-approved strings
/// for things like the cancellation policy. Nothing here writes anything - the bot can look things
/// up and hand off to a human, never take an action on someone's behalf.
///
/// Every request names a fixed topic directly, from a quick-reply the frontend rendered - there
/// is no free-text input and nothing here is ever guessed from typed text, so a request can never
/// name something the bot isn't actually prepared to answer.
/// </summary>
public class ChatbotService
{
    private const string SupportPhone = "+91 8657781526";
    private const string SupportEmail = "wecare@ojasaata.com";

    private readonly OrderService _orders;
    private readonly ProductService _products;
    private readonly DeliveryChargesService _deliveryCharges;

    public ChatbotService(OrderService orders, ProductService products, DeliveryChargesService deliveryCharges)
    {
        _orders = orders;
        _products = products;
        _deliveryCharges = deliveryCharges;
    }

    private static readonly List<ChatbotQuickReply> MainMenu =
    [
        new("Track my order", ChatbotTopics.OrderStatus),
        new("Delivery charges", ChatbotTopics.DeliveryCharge),
        new("Check product stock", ChatbotTopics.Stock),
        new("Cancellations & damaged items", ChatbotTopics.Policy),
        new("Talk to a human", ChatbotTopics.Human),
    ];

    public async Task<ChatbotResponse> AnswerAsync(ChatbotRequest request, ClaimsPrincipal user)
    {
        var topic = request.Topic;

        if (string.IsNullOrWhiteSpace(topic))
            return AnswerGreeting();

        if (topic.StartsWith(ChatbotTopics.StockProductPrefix, StringComparison.Ordinal))
            return await AnswerStockForProductAsync(topic[ChatbotTopics.StockProductPrefix.Length..]);

        return topic switch
        {
            ChatbotTopics.OrderStatus => await AnswerOrderStatusAsync(user),
            ChatbotTopics.DeliveryCharge => await AnswerDeliveryChargeAsync(),
            ChatbotTopics.Stock => await AnswerStockMenuAsync(),
            ChatbotTopics.Policy => AnswerPolicy(),
            ChatbotTopics.Human => AnswerHuman(),
            ChatbotTopics.Greeting => AnswerGreeting(),
            _ => AnswerFallback(),
        };
    }

    private async Task<ChatbotResponse> AnswerOrderStatusAsync(ClaimsPrincipal user)
    {
        var userId = user.FindFirstValue(ClaimTypes.NameIdentifier);
        if (string.IsNullOrWhiteSpace(userId))
        {
            return new ChatbotResponse(
                "Please log in first so I can look up your orders.",
                Escalate: false,
                MainMenu);
        }

        var orders = await _orders.GetOrdersByUserAsync(userId);
        var latest = orders.OrderByDescending(o => o.CreatedAt).FirstOrDefault();

        if (latest == null)
        {
            return new ChatbotResponse(
                "I don't see any orders on your account yet.",
                Escalate: false,
                MainMenu);
        }

        var reply = $"Your most recent order (placed {latest.CreatedAt:d MMM}) is currently: {latest.Status}. " +
            "Open \"My Orders\" for the full history and item details.";
        return new ChatbotResponse(reply, Escalate: false, MainMenu);
    }

    private async Task<ChatbotResponse> AnswerDeliveryChargeAsync()
    {
        var config = await _deliveryCharges.GetAsync();
        if (config == null || !config.IsActive)
        {
            return new ChatbotResponse(
                "Delivery pricing isn't set up right now - please contact our team for the current rates.",
                Escalate: true,
                MainMenu);
        }

        var reply = $"Delivery is free within {config.FreeDeliveryUpToKm:0.#} km of our store. " +
            $"Beyond that, it's ₹{config.PerKmChargeAfterFree:0.##} per km.";
        if (config.MaxDeliveryRadiusKm > 0)
            reply += $" We currently deliver up to {config.MaxDeliveryRadiusKm:0.#} km away.";

        return new ChatbotResponse(reply, Escalate: false, MainMenu);
    }

    /// <summary>Lists every product as its own quick-reply rather than asking the customer to
    /// type a name - the whole point of a button-only bot is that every next step is something
    /// it's actually prepared to answer.</summary>
    private async Task<ChatbotResponse> AnswerStockMenuAsync()
    {
        var products = await _products.GetAllAsync();
        if (products.Count == 0)
        {
            return new ChatbotResponse(
                "We don't have any products listed right now - please check back soon.",
                Escalate: false,
                MainMenu);
        }

        var quickReplies = products
            .OrderBy(p => p.Name)
            .Select(p => new ChatbotQuickReply(p.Name, $"{ChatbotTopics.StockProductPrefix}{p.Id}"))
            .ToList();

        return new ChatbotResponse("Which product would you like me to check?", Escalate: false, quickReplies);
    }

    private async Task<ChatbotResponse> AnswerStockForProductAsync(string productId)
    {
        var product = await _products.GetByIdAsync(productId);
        if (product == null)
        {
            return new ChatbotResponse(
                "That product isn't listed anymore. Here's what else I can help with:",
                Escalate: false,
                MainMenu);
        }

        string reply;
        if (!product.IsAvailable)
            reply = $"{product.Name} is currently unavailable.";
        else if (product.StockQuantity is int qty)
            reply = qty > 0 ? $"{product.Name} is in stock ({qty} left)." : $"{product.Name} is currently out of stock.";
        else
            reply = $"{product.Name} is in stock.";

        return new ChatbotResponse(reply, Escalate: false, MainMenu);
    }

    // Wording confirmed directly by the business owner (2026-08-20) - not invented, and not to be
    // changed without re-confirming, since this is real policy text a customer will act on.
    private static ChatbotResponse AnswerPolicy() => new(
        "You can cancel or change your order any time before it's packed for delivery - after that, it's locked in. " +
        "When your order arrives, you're welcome to check every item before accepting it: if anything is damaged or " +
        "incorrect, you can refuse it right at the door instead of accepting. Once you've accepted the delivery, the " +
        "order can no longer be cancelled.",
        Escalate: false,
        MainMenu);

    private static ChatbotResponse AnswerHuman() => new(
        $"Sure - you can reach our team directly at {SupportPhone} or {SupportEmail}, and we'll help you out.",
        Escalate: true,
        MainMenu);

    private static ChatbotResponse AnswerGreeting() => new(
        "Hi! I'm the Ojas assistant. I can help with order status, delivery charges, product stock, or cancellations - what do you need?",
        Escalate: false,
        MainMenu);

    private static ChatbotResponse AnswerFallback() => new(
        "I'm not quite sure about that one. Here's what I can help with, or you can reach our team directly:",
        Escalate: true,
        MainMenu);
}
