namespace OjasApi.Models;

/// <summary>
/// The fixed set of things the scripted support bot can answer. A request either names one of
/// these directly (the frontend's quick-reply buttons do this, so a click is never ambiguous) or
/// leaves it for keyword matching on free text to guess - see ChatbotService.DetectTopic.
/// </summary>
public static class ChatbotTopics
{
    public const string Greeting = "greeting";
    public const string OrderStatus = "order-status";
    public const string DeliveryCharge = "delivery-charge";
    public const string Stock = "stock";
    public const string Policy = "policy";
    public const string Human = "human";
    public const string Unknown = "unknown";
}
