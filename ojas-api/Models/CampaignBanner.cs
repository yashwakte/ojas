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

    [BsonElement("backgroundImageUrl")]
    public string BackgroundImageUrl { get; set; } = string.Empty;

    [BsonElement("isActive")]
    public bool IsActive { get; set; } = false;

    // Shown as "Handpicked for {FeaturedSectionTitle}" above this campaign's featured
    // products row on the home page, e.g. "This Festive Season", "Ganpati Celebrations".
    [BsonElement("featuredSectionTitle")]
    public string FeaturedSectionTitle { get; set; } = "This Campaign";

    [BsonElement("featuredProductIds")]
    public List<string> FeaturedProductIds { get; set; } = [];

    [BsonElement("fallbackBestsellerProductIds")]
    public List<string> FallbackBestsellerProductIds { get; set; } = [];

    [BsonElement("createdAt")]
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;

    [BsonElement("updatedAt")]
    public DateTime UpdatedAt { get; set; } = DateTime.UtcNow;
}
