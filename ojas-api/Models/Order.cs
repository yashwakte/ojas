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

    [BsonElement("notes")]
    public string Notes { get; set; } = string.Empty;

    [BsonElement("items")]
    public List<OrderItem> Items { get; set; } = [];

    [BsonElement("totalAmount")]
    public decimal TotalAmount { get; set; }

    [BsonElement("status")]
    public string Status { get; set; } = "Pending";

    [BsonElement("createdAt")]
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
}
