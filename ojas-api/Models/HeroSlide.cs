using MongoDB.Bson;
using MongoDB.Bson.Serialization.Attributes;

namespace OjasApi.Models;

/// <summary>
/// One picture in the home page's hero carousel.
///
/// The hero used to be a single file committed to the repository, which meant every change to
/// the first thing a customer sees was a code change and a deploy. A slide is a row here
/// instead, so the owner can put a festival poster on the front of the shop themselves.
///
/// The artwork is the whole slide: these posters are composed pieces that already carry their
/// own headline, wordmark and product line-up, and laying a second headline over one reads as
/// a mistake. So there is no title or subtitle here - only the picture, its alt text, and an
/// optional destination to send a tap to.
/// </summary>
public class HeroSlide
{
    [BsonId]
    [BsonRepresentation(BsonType.ObjectId)]
    public string? Id { get; set; }

    [BsonElement("imageUrl")]
    public string ImageUrl { get; set; } = string.Empty;

    /// <summary>
    /// What a screen reader announces in place of the picture. These posters carry real words -
    /// the product names, the brand line - so an empty alt would drop actual content, not
    /// decoration.
    /// </summary>
    [BsonElement("altText")]
    public string AltText { get; set; } = string.Empty;

    /// <summary>
    /// Optional. Where tapping the slide goes - a category, a product, a campaign. Empty means
    /// the picture is not a link, and the hero's own call-to-action buttons are the only way on.
    /// </summary>
    [BsonElement("linkUrl")]
    public string LinkUrl { get; set; } = string.Empty;

    [BsonElement("isActive")]
    public bool IsActive { get; set; } = true;

    /// <summary>
    /// Lowest first. Ties break on <see cref="CreatedAt"/>, so slides added without anybody
    /// thinking about order still come out oldest-first rather than in whatever order Mongo felt
    /// like returning them.
    /// </summary>
    [BsonElement("sortOrder")]
    public int SortOrder { get; set; }

    [BsonElement("createdAt")]
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;

    [BsonElement("updatedAt")]
    public DateTime UpdatedAt { get; set; } = DateTime.UtcNow;
}
