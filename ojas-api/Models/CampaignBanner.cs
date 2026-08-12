using MongoDB.Bson;
using MongoDB.Bson.Serialization.Attributes;

namespace OjasApi.Models;

public class CampaignBanner
{
    [BsonId]
    [BsonRepresentation(BsonType.ObjectId)]
    public string? Id { get; set; }

    [BsonElement("title")]
    public required string Title { get; set; }

    [BsonElement("subtitle")]
    public string Subtitle { get; set; } = string.Empty;

    [BsonElement("ctaText")]
    public string CtaText { get; set; } = string.Empty;

    [BsonElement("ctaLink")]
    public string CtaLink { get; set; } = string.Empty;

    [BsonElement("isActive")]
    public bool IsActive { get; set; } = false;

    [BsonElement("featuredProductIds")]
    public List<string> FeaturedProductIds { get; set; } = [];

    [BsonElement("fallbackBestsellerProductIds")]
    public List<string> FallbackBestsellerProductIds { get; set; } = [];

    [BsonElement("createdAt")]
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;

    [BsonElement("updatedAt")]
    public DateTime UpdatedAt { get; set; } = DateTime.UtcNow;
}
