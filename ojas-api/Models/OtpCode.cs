using MongoDB.Bson;
using MongoDB.Bson.Serialization.Attributes;

namespace OjasApi.Models;

public class OtpCode
{
    [BsonId]
    [BsonRepresentation(BsonType.ObjectId)]
    public string? Id { get; set; }

    /// <summary>Normalized email or phone number this code was issued for.</summary>
    [BsonElement("target")]
    public required string Target { get; set; }

    [BsonElement("channel")]
    public required string Channel { get; set; }

    [BsonElement("codeHash")]
    public required string CodeHash { get; set; }

    [BsonElement("expiresAt")]
    public DateTime ExpiresAt { get; set; }

    [BsonElement("attempts")]
    public int Attempts { get; set; }

    [BsonElement("createdAt")]
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
}

public static class OtpChannels
{
    public const string Email = "email";
    public const string Phone = "phone";

    /// <summary>Kept separate from Email so a device-enrollment code and a registration code
    /// for the same address can't overwrite one another - StoreCodeAsync clears prior codes
    /// per (target, channel).</summary>
    public const string Device = "device";

    /// <summary>Password reset. Separate channel again, so requesting a reset never invalidates
    /// a device-approval code the same person is midway through using.</summary>
    public const string PasswordReset = "password-reset";

    /// <summary>Signing in with a phone number instead of email+password. Kept separate from
    /// Phone (profile verification while already logged in) so a login code can't be replayed
    /// to verify a phone number, or vice versa.</summary>
    public const string PhoneLogin = "phone-login";
}
