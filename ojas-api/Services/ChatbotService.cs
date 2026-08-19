using System.Security.Claims;
using OjasApi.Models;

namespace OjasApi.Services;

/// <summary>
/// A deliberately scripted (not LLM-backed) support bot: every answer comes from live data via
/// the existing read-only service methods, or from a small set of fixed, human-approved strings
/// for things like the cancellation policy. Nothing here writes anything - the bot can look things
/// up and hand off to a human, never take an action on someone's behalf.
/// </summary>
public class ChatbotService
{
    private const string SupportPhone = "+91 8657781526";
    private const string SupportEmail = "ashamarketingpune@gmail.com";

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
        var topic = string.IsNullOrWhiteSpace(request.Topic) ? DetectTopic(request.Message) : request.Topic;

        return topic switch
        {
            ChatbotTopics.OrderStatus => await AnswerOrderStatusAsync(user),
            ChatbotTopics.DeliveryCharge => await AnswerDeliveryChargeAsync(),
            ChatbotTopics.Stock => await AnswerStockAsync(request.Message),
            ChatbotTopics.Policy => AnswerPolicy(),
            ChatbotTopics.Human => AnswerHuman(),
            ChatbotTopics.Greeting => AnswerGreeting(),
            _ => AnswerFallback(),
        };
    }

    /// <summary>Keyword matching, not NLU - good enough for a first-pass scripted bot, and
    /// deliberately checked in an order where the more specific/urgent intents (cancellations,
    /// wanting a person) win over broader ones.</summary>
    private static string DetectTopic(string? message)
    {
        var text = (message ?? string.Empty).Trim().ToLowerInvariant();
        if (text.Length == 0)
            return ChatbotTopics.Greeting;

        bool Has(params string[] keywords) => keywords.Any(text.Contains);

        if (Has("cancel", "refund", "damaged", "wrong item", "return", "broke", "broken"))
            return ChatbotTopics.Policy;
        if (Has("human", "agent", "real person", "help me", "talk to someone"))
            return ChatbotTopics.Human;
        if (Has("delivery charge", "delivery fee", "delivery cost", "shipping cost", "shipping fee"))
            return ChatbotTopics.DeliveryCharge;
        if (Has("track", "where is my order", "order status", "my order"))
            return ChatbotTopics.OrderStatus;
        if (Has("stock", "available", "do you have", "in stock"))
            return ChatbotTopics.Stock;
        if (Has("hi", "hello", "hey", "help"))
            return ChatbotTopics.Greeting;

        return ChatbotTopics.Unknown;
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

    private async Task<ChatbotResponse> AnswerStockAsync(string? message)
    {
        var text = (message ?? string.Empty).Trim();

        // A bare "stock" click (topic set with no product named yet) lands here too - ask rather
        // than guess.
        if (text.Length < 2 || text.Equals("stock", StringComparison.OrdinalIgnoreCase))
        {
            return new ChatbotResponse(
                "Sure - which product would you like me to check? Just type its name.",
                Escalate: false,
                []);
        }

        var products = await _products.GetAllAsync();
        var match = products.FirstOrDefault(p =>
            text.Contains(p.Name, StringComparison.OrdinalIgnoreCase) ||
            p.Name.Contains(text, StringComparison.OrdinalIgnoreCase));

        if (match == null)
        {
            return new ChatbotResponse(
                $"I couldn't find a product matching \"{text}\" - try the exact product name, or browse the full catalog on the Products page.",
                Escalate: false,
                MainMenu);
        }

        string reply;
        if (!match.IsAvailable)
            reply = $"{match.Name} is currently unavailable.";
        else if (match.StockQuantity is int qty)
            reply = qty > 0 ? $"{match.Name} is in stock ({qty} left)." : $"{match.Name} is currently out of stock.";
        else
            reply = $"{match.Name} is in stock.";

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
