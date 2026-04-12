using MongoDB.Bson;
using MongoDB.Bson.Serialization.Attributes;

namespace OjasApi.Models;

public class Product
{
    [BsonId]
    [BsonRepresentation(BsonType.ObjectId)]
    public string? Id { get; set; }

    [BsonElement("name")]
    public required string Name { get; set; }

    [BsonElement("description")]
    public required string Description { get; set; }

    [BsonElement("price")]
    public decimal Price { get; set; }

    [BsonElement("category")]
    public required string Category { get; set; }

    [BsonElement("imageUrl")]
    public string? ImageUrl { get; set; }

    [BsonElement("weight")]
    public required string Weight { get; set; }

    [BsonElement("isAvailable")]
    public bool IsAvailable { get; set; } = true;

    [BsonElement("createdAt")]
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
}
