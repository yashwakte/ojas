using MongoDB.Bson;
using MongoDB.Bson.Serialization.Attributes;

namespace OjasApi.Models;

public class DeliveryCharges
{
    [BsonId]
    [BsonRepresentation(BsonType.ObjectId)]
    public string? Id { get; set; }

    [BsonElement("warehouseAddress")]
    public required string WarehouseAddress { get; set; }

    [BsonElement("warehouseLatitude")]
    public double WarehouseLatitude { get; set; }

    [BsonElement("warehouseLongitude")]
    public double WarehouseLongitude { get; set; }

    [BsonElement("freeDeliveryUpToKm")]
    public double FreeDeliveryUpToKm { get; set; }

    [BsonElement("perKmChargeAfterFree")]
    public decimal PerKmChargeAfterFree { get; set; }

    // Serviceable radius from the warehouse. Orders pinned beyond this are
    // refused outright, which is how the Pune-only restriction is enforced.
    // 0 or less means "no limit", so existing configs keep working unchanged.
    [BsonElement("maxDeliveryRadiusKm")]
    public double MaxDeliveryRadiusKm { get; set; }

    [BsonElement("isActive")]
    public bool IsActive { get; set; } = true;

    [BsonElement("createdAt")]
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;

    [BsonElement("updatedAt")]
    public DateTime UpdatedAt { get; set; } = DateTime.UtcNow;
}