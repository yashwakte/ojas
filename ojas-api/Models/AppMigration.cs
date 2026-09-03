using MongoDB.Bson.Serialization.Attributes;

namespace OjasApi.Models;

/// <summary>
/// A record that a one-time data correction has already been applied.
///
/// Most of what runs at startup is safely repeatable: it only fills in fields that are absent,
/// so running it again changes nothing. Corrections that overwrite a value an administrator can
/// also edit are different. Re-applying those on every boot would quietly undo the admin's work
/// — change a price in the dashboard, restart the API, and it springs back — which is worse than
/// the problem being fixed. Those record themselves here and then never run again.
/// </summary>
public class AppMigration
{
    /// <summary>Stable, human-readable name of the migration, e.g. "product-pack-facts-2026-09".</summary>
    [BsonId]
    public required string Id { get; set; }

    [BsonElement("appliedAt")]
    public DateTime AppliedAt { get; set; } = DateTime.UtcNow;

    /// <summary>Free text for the audit trail — what it touched, and how many documents.</summary>
    [BsonElement("note")]
    public string Note { get; set; } = string.Empty;
}
