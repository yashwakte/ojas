using MongoDB.Bson;
using MongoDB.Bson.Serialization.Attributes;

namespace OjasApi.Models;

/// <summary>
/// A customer's rating and words about one product they bought and received.
///
/// Only a customer with a delivered order carrying the product may write one, so every review on
/// the storefront is a verified purchase - the thing that makes a review worth reading, and the
/// reason the owner wanted them in place of the home page's written-in testimonials.
///
/// One review per purchase: each delivered order lets its customer review each product on it
/// once, enforced by a unique index on (customer, product, order). They can edit that review but
/// not post a second for the same order; buying the product again, and receiving it, is a fresh
/// purchase and earns a fresh review, which shows when that purchase was made. The owner's rule
/// (2026-09-24, with the example: Modak Pith bought on 7 Sep and reviewed, bought again on 21 Sep
/// - the second purchase may be reviewed too).
///
/// Published the moment it is written. An admin can hide one (abuse, a phone number, a complaint
/// that belongs in support) but never edit its words or its stars - a shop that could rewrite its
/// reviews would have no reviews worth showing.
/// </summary>
[BsonIgnoreExtraElements]
public class ProductReview
{
    public const int MinRating = 1;
    public const int MaxRating = 5;
    public const int CommentMaxLength = 600;

    [BsonId]
    [BsonRepresentation(BsonType.ObjectId)]
    public string? Id { get; set; }

    [BsonElement("productId")]
    public required string ProductId { get; set; }

    /// <summary>Denormalised so the home page's review wall can name and link the product without
    /// a lookup per card. Display only.</summary>
    [BsonElement("productName")]
    public string ProductName { get; set; } = string.Empty;

    [BsonElement("userId")]
    public required string UserId { get; set; }

    /// <summary>The delivered order this review is for - one review per product per order. Shown
    /// to the author (so the orders page can tell which purchase is reviewed) and to the admin;
    /// never to other customers.</summary>
    [BsonElement("orderId")]
    public required string OrderId { get; set; }

    /// <summary>When that order was placed. Public: "Purchased 21 Sep 2026" is what tells two
    /// reviews by one customer apart - each is about a different purchase. Filled at boot for
    /// reviews written before it existed.</summary>
    [BsonElement("purchasedAt")]
    public DateTime? PurchasedAt { get; set; }

    /// <summary>What other shoppers see as the author: first name and the initial of the last,
    /// fixed when the review is written ("Priya S."). A full name and a city would be enough to
    /// find someone, and a review is public.</summary>
    [BsonElement("authorName")]
    public required string AuthorName { get; set; }

    [BsonElement("rating")]
    public int Rating { get; set; }

    [BsonElement("comment")]
    public string Comment { get; set; } = string.Empty;

    /// <summary>Taken down by an admin. Hidden reviews count towards nothing and are shown to no
    /// one but the admin and their author, who is told it is not public.</summary>
    [BsonElement("isHidden")]
    public bool IsHidden { get; set; }

    [BsonElement("createdAt")]
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;

    [BsonElement("updatedAt")]
    public DateTime? UpdatedAt { get; set; }

    /// <summary>"Priya Sharma" → "Priya S.", "Priya" → "Priya", nothing → "Ojas customer".</summary>
    public static string PublicName(string? fullName)
    {
        var parts = (fullName ?? string.Empty)
            .Split(' ', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries);
        if (parts.Length == 0) return "Ojas customer";

        var first = parts[0].Length > 24 ? parts[0][..24] : parts[0];
        return parts.Length == 1 ? first : $"{first} {char.ToUpperInvariant(parts[^1][0])}.";
    }
}
