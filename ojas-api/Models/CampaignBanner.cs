using MongoDB.Bson;
using MongoDB.Bson.Serialization.Attributes;

namespace OjasApi.Models;

public class CampaignBanner
{
    [BsonId]
    [BsonRepresentation(BsonType.ObjectId)]
    public string? Id { get; set; }

    // Optional. Festival artwork generally carries its own headline, and overlaying a
    // second one on the same picture reads as a mistake - so a campaign is allowed to be
    // nothing but its image and its call to action.
    [BsonElement("title")]
    public string Title { get; set; } = string.Empty;

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
