using System.Security.Cryptography;
using Microsoft.Extensions.Caching.Memory;
using MongoDB.Driver;
using OjasApi.Models;

namespace OjasApi.Services;

/// <summary>Why a set of bytes was refused, so the caller can say something useful.</summary>
public enum MediaRejection
{
    None,
    Empty,
    TooLarge,
    NotAnImage,
    DimensionsTooLarge,
}

public sealed record MediaStoreResult(string? Url, MediaRejection Rejection, int Width, int Height)
{
    public bool Succeeded => Rejection == MediaRejection.None;
}

/// <summary>
/// The image store. Images go in as bytes and come out as their own cacheable HTTP resource.
///
/// Storage is content-addressed: an image's identity *is* the SHA-256 of its bytes. Uploading
/// the same picture twice stores it once and hands back the same URL, and editing a picture
/// necessarily produces a new URL, which is what lets <see cref="MediaController"/> mark every
/// response <c>immutable</c> for a year without ever risking a stale image on someone's screen.
///
/// Reads are memory-cached, because the point of this class is to survive traffic. A CDN or
/// browser cache miss should cost a dictionary lookup, not a database round trip - at any real
/// volume the origin must not be re-reading the same twenty pictures out of Mongo all day.
/// </summary>
public class MediaService : IDisposable
{
    /// <summary>Generous enough for a full-bleed campaign photo, small enough that no single
    /// upload can bloat a Mongo document beyond its 16 MB ceiling.</summary>
    public const int MaxBytes = 6 * 1024 * 1024;

    /// <summary>Nothing on the storefront is displayed anywhere near this wide; beyond it an
    /// upload is a mistake or an attempt to waste storage.</summary>
    public const int MaxDimension = 4096;

    private static readonly TimeSpan CacheLifetime = TimeSpan.FromHours(12);

    /// <summary>Roughly a whole storefront's worth of pictures, evicted least-recently-used.</summary>
    private const long CacheByteBudget = 64L * 1024 * 1024;

    private readonly IMongoDbService _db;
    private readonly ILogger<MediaService> _logger;

    // Owned rather than injected: this cache is measured in bytes and needs a size limit, and
    // imposing that on an application-wide IMemoryCache would make every unrelated future
    // caller responsible for declaring a size. Registered as a singleton so it actually lives
    // between requests, which is the entire point of it.
    private readonly MemoryCache _cache = new(new MemoryCacheOptions { SizeLimit = CacheByteBudget });

    public MediaService(IMongoDbService db, ILogger<MediaService> logger)
    {
        _db = db;
        _logger = logger;
    }

    /// <summary>The path the storefront should reference. Same origin, so no CORS and no extra DNS lookup.</summary>
    public static string UrlFor(MediaAsset asset) => $"/api/media/{asset.Hash}.{ImageInspector.ExtensionFor(asset.ContentType)}";

    public async Task<MediaStoreResult> StoreAsync(byte[] data, CancellationToken ct = default)
    {
        if (data.Length == 0) return new MediaStoreResult(null, MediaRejection.Empty, 0, 0);
        if (data.Length > MaxBytes) return new MediaStoreResult(null, MediaRejection.TooLarge, 0, 0);

        // Identified from the bytes themselves - see ImageInspector for why the caller's own
        // claim about the format is never taken at face value.
        var info = ImageInspector.Inspect(data);
        if (info == null) return new MediaStoreResult(null, MediaRejection.NotAnImage, 0, 0);
        if (info.Width <= 0 || info.Height <= 0 || info.Width > MaxDimension || info.Height > MaxDimension)
            return new MediaStoreResult(null, MediaRejection.DimensionsTooLarge, info.Width, info.Height);

        var hash = Convert.ToHexStringLower(SHA256.HashData(data));

        var existing = await _db.MediaAssets.Find(a => a.Hash == hash).FirstOrDefaultAsync(ct);
        if (existing != null)
            return new MediaStoreResult(UrlFor(existing), MediaRejection.None, existing.Width, existing.Height);

        var asset = new MediaAsset
        {
            Hash = hash,
            ContentType = info.ContentType,
            Data = data,
            Width = info.Width,
            Height = info.Height,
            ByteSize = data.Length,
        };

        try
        {
            await _db.MediaAssets.InsertOneAsync(asset, cancellationToken: ct);
        }
        catch (MongoWriteException ex) when (ex.WriteError?.Category == ServerErrorCategory.DuplicateKey)
        {
            // Two admins uploading the same picture at the same moment. The unique index on the
            // hash is what settles it; both callers want the same URL anyway.
        }

        return new MediaStoreResult(UrlFor(asset), MediaRejection.None, info.Width, info.Height);
    }

    public async Task<MediaAsset?> GetByHashAsync(string hash, CancellationToken ct = default)
    {
        if (string.IsNullOrWhiteSpace(hash)) return null;

        if (_cache.TryGetValue<MediaAsset>(CacheKey(hash), out var cached)) return cached;

        var asset = await _db.MediaAssets.Find(a => a.Hash == hash).FirstOrDefaultAsync(ct);
        if (asset != null)
        {
            _cache.Set(CacheKey(hash), asset, new MemoryCacheEntryOptions
            {
                SlidingExpiration = CacheLifetime,
                Size = asset.ByteSize,
            });
        }

        return asset;
    }

    /// <summary>
    /// Converts a legacy <c>data:image/...;base64,...</c> string into a stored asset and returns
    /// its URL. Anything that is not such a string is handed straight back unchanged, which is
    /// what makes the migration in <see cref="MediaMigrationService"/> safe to re-run.
    /// </summary>
    public async Task<string> MigrateDataUrlAsync(string? value, CancellationToken ct = default)
    {
        if (string.IsNullOrWhiteSpace(value) || !value.StartsWith("data:image/", StringComparison.OrdinalIgnoreCase))
            return value ?? string.Empty;

        var comma = value.IndexOf(',');
        if (comma < 0) return value;

        byte[] bytes;
        try
        {
            bytes = Convert.FromBase64String(value[(comma + 1)..]);
        }
        catch (FormatException)
        {
            _logger.LogWarning("Skipping an inline image whose base64 payload could not be decoded");
            return value;
        }

        var result = await StoreAsync(bytes, ct);
        if (!result.Succeeded)
        {
            _logger.LogWarning("Skipping an inline image rejected as {Rejection}", result.Rejection);
            return value;
        }

        return result.Url!;
    }

    private static string CacheKey(string hash) => $"media:{hash}";

    /// <summary>Releases the image cache when the application shuts down.</summary>
    public void Dispose()
    {
        _cache.Dispose();
        GC.SuppressFinalize(this);
    }
}
