using MongoDB.Bson.Serialization.Attributes;

namespace OjasApi.Models;

/// <summary>
/// Proof that this browser has just verified a mobile number with no Ojas account behind it, so
/// the customer can type their name, email and password without being sent a second text code -
/// each one costs money.
///
/// It exists because whether a number has an account is now only ever revealed AFTER the number
/// is proved. Checkout used to ask before sending the code, which let anyone test any number (and
/// any email) against the customer list. The raw ticket lives only in an HttpOnly cookie scoped to
/// the sign-in endpoint; this row keeps its SHA-256 as the _id, the number it was issued for, and
/// how many times it has been presented. Five uses or fifteen minutes, whichever comes first.
/// </summary>
public class PhoneSignupTicket
{
    public const int MaxUses = 5;
    public static readonly TimeSpan Lifetime = TimeSpan.FromMinutes(15);

    [BsonId]
    public required string TicketHash { get; set; }

    [BsonElement("phone")]
    public required string Phone { get; set; }

    [BsonElement("uses")]
    public int Uses { get; set; }

    [BsonElement("expiresAt")]
    public DateTime ExpiresAt { get; set; }
}
