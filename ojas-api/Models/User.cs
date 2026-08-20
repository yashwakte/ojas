using MongoDB.Bson;
using MongoDB.Bson.Serialization.Attributes;

namespace OjasApi.Models;

/// <summary>
/// Tolerant of fields that no longer map to a property. The driver writes every mapped member,
/// nulls included, so a field lives on in stored documents long after the property is deleted -
/// and without this attribute the driver throws on those documents, making existing accounts
/// unreadable. That is exactly what happened when RegisteredDeviceId was retired in favour of
/// the staff_devices collection.
/// </summary>
[BsonIgnoreExtraElements]
public class User
{
    [BsonId]
    [BsonRepresentation(BsonType.ObjectId)]
    public string? Id { get; set; }

    [BsonElement("fullName")]
    public required string FullName { get; set; }

    [BsonElement("email")]
    public required string Email { get; set; }

    [BsonElement("phone")]
    public required string Phone { get; set; }

    [BsonElement("passwordHash")]
    public required string PasswordHash { get; set; }

    [BsonElement("role")]
    public string Role { get; set; } = UserRoles.Customer;

    [BsonElement("isEmailVerified")]
    public bool IsEmailVerified { get; set; }

    [BsonElement("isPhoneVerified")]
    public bool IsPhoneVerified { get; set; }

    [BsonElement("createdAt")]
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;

    [BsonElement("savedAddresses")]
    public List<SavedAddress> SavedAddresses { get; set; } = [];

    /// <summary>Set by an admin via "approve next device" so this staff member's next device
    /// enrollment can complete on password alone, with no email round-trip. Exists for the case
    /// where email delivery itself is down (the original break-glass gap: revoking a lost device
    /// still left re-enrollment stuck behind an OTP email). Null means no standing approval;
    /// cleared the moment it's consumed or once it expires.</summary>
    [BsonElement("pendingDeviceApprovalExpiresAt")]
    public DateTime? PendingDeviceApprovalExpiresAt { get; set; }
}

public static class UserRoles
{
    public const string Customer = "customer";
    public const string Admin = "admin";
    public const string Delivery = "delivery";
}

public class SavedAddress
{
    [BsonElement("label")]
    public string Label { get; set; } = string.Empty;

    /// <summary>Empty for addresses saved before this field existed - falls back to the
    /// account phone on the frontend rather than forcing a backfill.</summary>
    [BsonElement("phone")]
    public string Phone { get; set; } = string.Empty;

    [BsonElement("fullAddress")]
    public string FullAddress { get; set; } = string.Empty;

    [BsonElement("latitude")]
    public double Latitude { get; set; }

    [BsonElement("longitude")]
    public double Longitude { get; set; }

    [BsonElement("mapLink")]
    public string? MapLink { get; set; }

    [BsonElement("isDefault")]
    public bool IsDefault { get; set; }
}
