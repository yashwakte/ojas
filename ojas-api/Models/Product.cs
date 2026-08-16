using MongoDB.Bson;
using MongoDB.Bson.Serialization.Attributes;
using System.ComponentModel.DataAnnotations;

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

    [BsonElement("discount")]
    public decimal Discount { get; set; }

    [BsonElement("category")]
    public required string Category { get; set; }

    [BsonElement("imageUrl")]
    public string ImageUrl { get; set; } = string.Empty;

    [BsonElement("galleryImageUrls")]
    public List<string> GalleryImageUrls { get; set; } = [];

    [BsonElement("weight")]
    public required string Weight { get; set; }

    [BsonElement("isAvailable")]
    public bool IsAvailable { get; set; } = true;

    /// <summary>
    /// Units on hand. Null means stock is not tracked for this product yet — it
    /// stays purchasable and is never decremented. That keeps every pre-existing
    /// product buyable after this feature ships, so the shop doesn't go dark;
    /// admins opt each product in by setting a number.
    /// </summary>
    [BsonElement("stockQuantity")]
    public int? StockQuantity { get; set; }

    /// <summary>At or below this (and above zero), admin sees a low-stock warning.</summary>
    [BsonElement("lowStockThreshold")]
    public int LowStockThreshold { get; set; } = 5;

    [BsonElement("ingredients")]
    public string Ingredients { get; set; } = string.Empty;

    [BsonElement("benefits")]
    public string Benefits { get; set; } = string.Empty;

    [BsonElement("storageInfo")]
    public string StorageInfo { get; set; } = string.Empty;

    [BsonElement("createdAt")]
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;

    [BsonElement("updatedAt")]
    public DateTime UpdatedAt { get; set; } = DateTime.UtcNow;
}

public sealed class CreateProductRequest
{
    [Required, StringLength(100, MinimumLength = 2)]
    public string Name { get; init; } = string.Empty;

    [Required, StringLength(2000, MinimumLength = 10)]
    public string Description { get; init; } = string.Empty;

    [Range(typeof(decimal), "0.01", "100000")]
    public decimal Price { get; init; }

    [Range(typeof(decimal), "0", "100")]
    public decimal Discount { get; init; }

    [Required, StringLength(100)]
    public string Category { get; init; } = string.Empty;

    [Required, StringLength(7_000_000, MinimumLength = 5)]
    public string ImageUrl { get; init; } = string.Empty;

    public List<string> GalleryImageUrls { get; init; } = [];

    [Required, StringLength(100)]
    public string Weight { get; init; } = string.Empty;

    public bool IsAvailable { get; init; } = true;

    [Range(0, 1_000_000)]
    public int? StockQuantity { get; init; }

    [Range(0, 10_000)]
    public int? LowStockThreshold { get; init; }

    [Required, StringLength(3000, MinimumLength = 5)]
    public string Ingredients { get; init; } = string.Empty;

    [Required, StringLength(3000, MinimumLength = 10)]
    public string Benefits { get; init; } = string.Empty;

    [Required, StringLength(2000, MinimumLength = 10)]
    public string StorageInfo { get; init; } = string.Empty;
}

public sealed class UpdateProductRequest
{
    [StringLength(100, MinimumLength = 2)]
    public string? Name { get; init; }

    [StringLength(2000, MinimumLength = 10)]
    public string? Description { get; init; }

    [Range(typeof(decimal), "0.01", "100000")]
    public decimal? Price { get; init; }

    [Range(typeof(decimal), "0", "100")]
    public decimal? Discount { get; init; }

    [StringLength(100)]
    public string? Category { get; init; }

    [StringLength(7_000_000, MinimumLength = 5)]
    public string? ImageUrl { get; init; }

    public List<string>? GalleryImageUrls { get; init; }

    [StringLength(100)]
    public string? Weight { get; init; }

    public bool? IsAvailable { get; init; }

    [Range(0, 1_000_000)]
    public int? StockQuantity { get; init; }

    [Range(0, 10_000)]
    public int? LowStockThreshold { get; init; }

    [StringLength(3000, MinimumLength = 5)]
    public string? Ingredients { get; init; }

    [StringLength(3000, MinimumLength = 10)]
    public string? Benefits { get; init; }

    [StringLength(2000, MinimumLength = 10)]
    public string? StorageInfo { get; init; }
}
