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

    [BsonElement("subtotal")]
    public decimal Subtotal { get; set; }

    /// <summary>Null when no coupon was applied (or the one requested didn't validate).</summary>
    [BsonElement("couponCode")]
    public string? CouponCode { get; set; }

    [BsonElement("discountPercentage")]
    public decimal DiscountPercentage { get; set; }

    [BsonElement("discountAmount")]
    public decimal DiscountAmount { get; set; }

    [BsonElement("deliveryCharge")]
    public decimal DeliveryCharge { get; set; }

    [BsonElement("deliveryDistanceKm")]
    public double DeliveryDistanceKm { get; set; }

    [BsonElement("totalAmount")]
    public decimal TotalAmount { get; set; }

    [BsonElement("status")]
    public string Status { get; set; } = "Pending";

    /// <summary>"COD" or "Cashfree". Kept as a field rather than hardcoded everywhere so
    /// another gateway could slot in later without touching the order shape again.</summary>
    [BsonElement("paymentMethod")]
    public string PaymentMethod { get; set; } = "COD";

    [BsonElement("paymentStatus")]
    public string PaymentStatus { get; set; } = "Pending";

    /// <summary>Cashfree's payment_session_id for this order - the frontend's checkout SDK
    /// needs it to open the hosted payment page. Null for COD orders.</summary>
    [BsonElement("paymentSessionId")]
    public string? PaymentSessionId { get; set; }

    /// <summary>Cashfree's own payment identifier, recorded once a PAYMENT_SUCCESS_WEBHOOK
    /// confirms the charge - kept for reconciliation and as the audit trail behind a refund.</summary>
    [BsonElement("cfPaymentId")]
    public string? CfPaymentId { get; set; }

    [BsonElement("deliveryPartnerId")]
    public string? DeliveryPartnerId { get; set; }

    [BsonElement("deliveryPartnerName")]
    public string? DeliveryPartnerName { get; set; }

    [BsonElement("createdAt")]
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;

    [BsonElement("updatedAt")]
    public DateTime? UpdatedAt { get; set; }
}
