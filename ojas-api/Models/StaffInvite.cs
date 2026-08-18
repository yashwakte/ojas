using MongoDB.Bson.Serialization.Attributes;

namespace OjasApi.Models;

/// <summary>
/// A single-use link that lets a newly created staff member set their own password. It exists so
/// an admin never has to invent a temporary password and pass it along over chat - which meant
/// the admin knew every staff credential, and nothing ever forced it to be changed.
///
/// Same storage treatment as RefreshToken: high-entropy server-generated data, so only its
/// SHA-256 hash is kept, and that hash doubles as the document _id for an indexed lookup by
/// presented token. Accepting the invite deletes it, and a TTL index sweeps up ones nobody used.
/// </summary>
[BsonIgnoreExtraElements]
public class StaffInvite
{
    [BsonId]
    public required string TokenHash { get; set; }

    [BsonElement("userId")]
    public required string UserId { get; set; }

    [BsonElement("expiresAt")]
    public DateTime ExpiresAt { get; set; }

    [BsonElement("createdAt")]
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
}
