using MongoDB.Bson;
using MongoDB.Bson.Serialization.Attributes;

namespace OjasApi.Models;

/// <summary>
/// The one device a staff account (admin or delivery) is allowed to sign in from. The raw
/// device id is server-generated random data handed to the browser in an HttpOnly cookie, so
/// - unlike a fingerprint or a localStorage value - script running on the page can neither
/// read it nor forge it; an attacker needs the actual browser profile, not just the password.
///
/// Only the SHA-256 hash is stored. Same reasoning as RefreshToken: this is high-entropy
/// server-generated data, so a fast one-way hash is enough - bcrypt's slow hashing exists to
/// resist brute-forcing *guessable* secrets, which this isn't.
///
/// One row per (user, device). A device id identifies a *browser*, not a person, so several
/// staff sharing one computer are all bound to the same id - which is why the hash can't be
/// the document _id. The cap is one device per person, not one person per device.
/// </summary>
[BsonIgnoreExtraElements]
public class StaffDevice
{
    [BsonId]
    [BsonRepresentation(BsonType.ObjectId)]
    public string? Id { get; set; }

    [BsonElement("deviceIdHash")]
    public required string DeviceIdHash { get; set; }

    [BsonElement("userId")]
    public required string UserId { get; set; }

    /// <summary>Human-readable label derived from the User-Agent ("Chrome on Windows"), shown
    /// in the admin UI so a device can be recognised before it's revoked.</summary>
    [BsonElement("label")]
    public string Label { get; set; } = "Unknown device";

    [BsonElement("enrolledVia")]
    public string EnrolledVia { get; set; } = DeviceEnrollmentMethods.EmailOtp;

    [BsonElement("createdAt")]
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;

    [BsonElement("lastSeenAt")]
    public DateTime LastSeenAt { get; set; } = DateTime.UtcNow;
}

public static class DeviceEnrollmentMethods
{
    public const string EmailOtp = "email-otp";
    public const string Bootstrap = "bootstrap";
}
