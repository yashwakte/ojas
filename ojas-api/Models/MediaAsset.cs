using MongoDB.Bson;
using MongoDB.Bson.Serialization.Attributes;

namespace OjasApi.Models;

/// <summary>
/// One stored image, kept as bytes and served as its own HTTP resource rather than
/// being inlined into whatever document happens to reference it.
///
/// Inlining was the old design: a banner's picture lived as a base64 <c>data:</c> string
/// on the banner document, so <c>GET /api/campaign-banner</c> shipped 2.8 MB of image on
/// every single page load, uncacheable, straight out of the origin. Base64 also costs a
/// third more bytes than the binary it encodes, and an image welded into a JSON body can
/// never be lazily loaded, cached separately, or revalidated.
///
/// The key here is the SHA-256 of the bytes, which makes the URL content-addressed: the
/// same picture always lands on the same URL, and a *different* picture is necessarily a
/// different URL. That is what makes it safe to serve these with a one-year
/// <c>immutable</c> cache - there is no such thing as stale, because content changing
/// means the URL changed too. Cache invalidation stops being a problem we have to solve.
/// </summary>
public class MediaAsset
{
    [BsonId]
    [BsonRepresentation(BsonType.ObjectId)]
    public string? Id { get; set; }

    /// <summary>Lowercase hex SHA-256 of <see cref="Data"/>. The public URL is /api/media/{hash}.{ext}.</summary>
    [BsonElement("hash")]
    public required string Hash { get; set; }

    [BsonElement("contentType")]
    public required string ContentType { get; set; }

    [BsonElement("data")]
    public required byte[] Data { get; set; }

    [BsonElement("width")]
    public int Width { get; set; }

    [BsonElement("height")]
    public int Height { get; set; }

    [BsonElement("byteSize")]
    public int ByteSize { get; set; }

    [BsonElement("createdAt")]
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
}
