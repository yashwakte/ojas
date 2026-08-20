namespace OjasApi.Models;

/// <summary>
/// The fixed set of things the scripted support bot can answer. Every request names one of these
/// directly - the frontend is quick-reply-button-driven only, no free text, so there's never a
/// topic to guess at.
/// </summary>
public static class ChatbotTopics
{
    public const string Greeting = "greeting";
    public const string OrderStatus = "order-status";
    public const string DeliveryCharge = "delivery-charge";
    public const string Stock = "stock";
    public const string Policy = "policy";
    public const string Human = "human";

    /// <summary>Prefix for a specific product's stock check, e.g. "stock:&lt;productId&gt;" -
    /// the id comes from a quick-reply generated per product, never typed.</summary>
    public const string StockProductPrefix = "stock:";
}
