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

    /// <summary>Kept separate from Email so a device-enrollment code and a registration code
    /// for the same address can't overwrite one another - StoreCodeAsync clears prior codes
    /// per (target, channel).</summary>
    public const string Device = "device";

    /// <summary>Password reset. Separate channel again, so requesting a reset never invalidates
    /// a device-approval code the same person is midway through using.</summary>
    public const string PasswordReset = "password-reset";

    /// <summary>A signed-in customer confirming the email already on their account. Kept apart
    /// from EmailChange on purpose: a confirmation code needs no password to request, so it must
    /// never be redeemable as a change - if the account's email moves on after the code was sent,
    /// the old code is looked up under the change channel, is not found there, and dies.</summary>
    public const string EmailConfirm = "email-confirm";

    /// <summary>A signed-in customer moving their account to a new email. Only ever issued after
    /// the current password has been checked.</summary>
    public const string EmailChange = "email-change";
}
