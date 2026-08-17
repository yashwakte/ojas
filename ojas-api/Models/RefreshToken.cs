using MongoDB.Bson.Serialization.Attributes;

namespace OjasApi.Models;

/// <summary>
/// A refresh token is server-generated, high-entropy random data (32 bytes), unlike a
/// user-chosen password or a low-entropy OTP - so a fast one-way hash (SHA-256) is enough to
/// protect it if the database is ever read directly; it doesn't need bcrypt's slow, adaptive
/// hashing, which exists specifically to resist brute-forcing *guessable* secrets. The hash
/// doubles as the document _id, so a lookup by presented token is a direct, indexed read
/// rather than a table scan.
/// </summary>
public class RefreshToken
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
