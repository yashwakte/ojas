using MongoDB.Bson;
using MongoDB.Bson.Serialization.Attributes;

namespace OjasApi.Models;

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

    [BsonElement("createdAt")]
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;

    [BsonElement("savedAddresses")]
    public List<SavedAddress> SavedAddresses { get; set; } = [];
}

public class SavedAddress
{
    [BsonElement("label")]
    public string Label { get; set; } = string.Empty;

    [BsonElement("fullAddress")]
    public string FullAddress { get; set; } = string.Empty;

    [BsonElement("isDefault")]
    public bool IsDefault { get; set; }
}
