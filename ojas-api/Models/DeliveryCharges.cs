using MongoDB.Bson;
using MongoDB.Bson.Serialization.Attributes;

namespace OjasApi.Models;

/// <summary>
/// A pincode Ojas delivers to, and what delivery there costs. Charging by pincode rather than by
/// distance from a map pin is deliberate: the pin comes from the browser, so anything priced off
/// it can be priced to zero by a crafted request. A pincode is stated in the address, checked
/// against this list on the server, and verifiable at the door.
/// </summary>
public class ServiceableArea
{
    /// <summary>Six digits, e.g. "411014".</summary>
    [BsonElement("pincode")]
    public required string Pincode { get; set; }

    /// <summary>What delivery to this pincode costs, before the free-delivery cart threshold
    /// waives it. Null means fall back to <see cref="DeliveryCharges.DefaultDeliveryCharge"/>.</summary>
    [BsonElement("charge")]
    public decimal? Charge { get; set; }

    /// <summary>For the admin's own reference — "Kharadi", "Viman Nagar".</summary>
    [BsonElement("label")]
    public string? Label { get; set; }
}

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

    /// <summary>
    /// The pincodes Ojas delivers to. When this list is non-empty it is the authority on both
    /// questions that used to be answered from the customer's map pin — whether we deliver there
    /// at all, and what it costs — and the pin stops affecting money entirely, becoming purely
    /// navigation for the delivery partner.
    ///
    /// Empty means it has never been configured, in which case the older distance-from-pin rules
    /// below still apply. Those trust a coordinate the browser supplies, so a request claiming the
    /// warehouse's own position gets free delivery: configure this before going live.
    /// </summary>
    [BsonElement("serviceableAreas")]
    public List<ServiceableArea> ServiceableAreas { get; set; } = [];

    /// <summary>What delivery costs for a serviceable pincode that doesn't name its own charge.</summary>
    [BsonElement("defaultDeliveryCharge")]
    public decimal DefaultDeliveryCharge { get; set; }

    /// <summary>True once delivery is priced from the pincode list rather than from a map pin.</summary>
    public bool ChargesByPincode => ServiceableAreas.Count > 0;

    [BsonElement("isActive")]
    public bool IsActive { get; set; } = true;

    [BsonElement("createdAt")]
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;

    [BsonElement("updatedAt")]
    public DateTime UpdatedAt { get; set; } = DateTime.UtcNow;
}