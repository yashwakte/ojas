using MongoDB.Bson;
using MongoDB.Bson.Serialization.Attributes;

namespace OjasApi.Models;

public class OrderItem
{
    [BsonElement("productId")]
    public required string ProductId { get; set; }

    [BsonElement("productName")]
    public required string ProductName { get; set; }

    [BsonElement("price")]
    public decimal Price { get; set; }

    [BsonElement("weight")]
    public required string Weight { get; set; }

    [BsonElement("quantity")]
    public int Quantity { get; set; }
}

public class Order
{
    [BsonId]
    [BsonRepresentation(BsonType.ObjectId)]
    public string? Id { get; set; }

    [BsonElement("userId")]
    public string? UserId { get; set; }

    [BsonElement("fullName")]
    public required string FullName { get; set; }

    [BsonElement("phone")]
    public required string Phone { get; set; }

    [BsonElement("address")]
    public required string Address { get; set; }

    [BsonElement("latitude")]
    public double Latitude { get; set; }

    [BsonElement("longitude")]
    public double Longitude { get; set; }

    [BsonElement("addressMapLink")]
    public string? AddressMapLink { get; set; }

    [BsonElement("notes")]
    public string Notes { get; set; } = string.Empty;

    [BsonElement("items")]
    public List<OrderItem> Items { get; set; } = [];

    [BsonElement("deliveryCharge")]
    public decimal DeliveryCharge { get; set; }

    [BsonElement("deliveryDistanceKm")]
    public double DeliveryDistanceKm { get; set; }

    [BsonElement("totalAmount")]
    public decimal TotalAmount { get; set; }

    [BsonElement("status")]
    public string Status { get; set; } = "Pending";

    /// <summary>Only "COD" today. Kept as a field rather than hardcoded everywhere so an
    /// online method (Razorpay) can slot in later without touching the order shape again.</summary>
    [BsonElement("paymentMethod")]
    public string PaymentMethod { get; set; } = "COD";

    [BsonElement("paymentStatus")]
    public string PaymentStatus { get; set; } = "Pending";

    [BsonElement("deliveryPartnerId")]
    public string? DeliveryPartnerId { get; set; }

    [BsonElement("deliveryPartnerName")]
    public string? DeliveryPartnerName { get; set; }

    [BsonElement("createdAt")]
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;

    [BsonElement("updatedAt")]
    public DateTime? UpdatedAt { get; set; }
}
