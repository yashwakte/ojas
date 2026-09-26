using MongoDB.Bson.Serialization.Attributes;

namespace OjasApi.Models;

/// <summary>
/// A MSG91 widget token that has already been exchanged for a session. MSG91 says whether a token
/// is genuine; it does not promise to refuse the same token twice, and a phone-verified sign-in is
/// now enough on its own to open an existing account. So the redemption is recorded here and a
/// second presentation of the same token is refused, whatever MSG91 would have said about it.
///
/// The SHA-256 of the token is the _id, which makes "claim it" a single insert that the database
/// itself guarantees only one caller can win, and the TTL index clears the row once the token
/// could no longer have been valid anyway.
/// </summary>
public class UsedPhoneToken
{
    [BsonId]
    public required string TokenHash { get; set; }

    [BsonElement("expiresAt")]
    public DateTime ExpiresAt { get; set; }
}
