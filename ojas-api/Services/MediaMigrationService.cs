using MongoDB.Driver;
using OjasApi.Models;

namespace OjasApi.Services;

/// <summary>
/// Moves images that were saved as inline <c>data:</c> strings out of the documents that
/// reference them and into the media store, rewriting the reference to a URL.
///
/// This runs once at startup and is a no-op from then on: it only ever looks at values
/// beginning <c>data:image/</c>, and after a successful pass there are none left. Failing
/// halfway is safe too, because each document is rewritten independently and re-running picks
/// up wherever it stopped. It exists because the storefront's live banner and catalog already
/// hold these blobs in production - without it, shipping the new pipeline would blank every
/// existing picture.
/// </summary>
public class MediaMigrationService
{
    private readonly IMongoDbService _db;
    private readonly MediaService _media;
    private readonly ILogger<MediaMigrationService> _logger;

    public MediaMigrationService(IMongoDbService db, MediaService media, ILogger<MediaMigrationService> logger)
    {
        _db = db;
        _media = media;
        _logger = logger;
    }

    public async Task RunAsync(CancellationToken ct = default)
    {
        var moved = 0;
        moved += await MigrateBannersAsync(ct);
        moved += await MigrateProductsAsync(ct);

        if (moved > 0)
            _logger.LogInformation("Moved {Count} inline image(s) into the media store", moved);
    }

    private async Task<int> MigrateBannersAsync(CancellationToken ct)
    {
        var banners = await _db.CampaignBanners
            .Find(b => b.BackgroundImageUrl != null && b.BackgroundImageUrl.StartsWith("data:image/"))
            .ToListAsync(ct);

        var moved = 0;
        foreach (var banner in banners)
        {
            var url = await _media.MigrateDataUrlAsync(banner.BackgroundImageUrl, ct);
            if (url == banner.BackgroundImageUrl) continue;

            await _db.CampaignBanners.UpdateOneAsync(
                b => b.Id == banner.Id,
                Builders<CampaignBanner>.Update.Set(b => b.BackgroundImageUrl, url),
                cancellationToken: ct);
            moved++;
        }

        return moved;
    }

    private async Task<int> MigrateProductsAsync(CancellationToken ct)
    {
        var filter = Builders<Product>.Filter.Or(
            Builders<Product>.Filter.Regex(p => p.ImageUrl, "^data:image/"),
            Builders<Product>.Filter.Regex("galleryImageUrls", "^data:image/"));

        var products = await _db.Products.Find(filter).ToListAsync(ct);

        var moved = 0;
        foreach (var product in products)
        {
            var image = await _media.MigrateDataUrlAsync(product.ImageUrl, ct);

            var gallery = new List<string>();
            foreach (var entry in product.GalleryImageUrls ?? [])
                gallery.Add(await _media.MigrateDataUrlAsync(entry, ct));

            var imageChanged = image != product.ImageUrl;
            var galleryChanged = !gallery.SequenceEqual(product.GalleryImageUrls ?? []);
            if (!imageChanged && !galleryChanged) continue;

            await _db.Products.UpdateOneAsync(
                p => p.Id == product.Id,
                Builders<Product>.Update
                    .Set(p => p.ImageUrl, image)
                    .Set(p => p.GalleryImageUrls, gallery),
                cancellationToken: ct);
            moved += (imageChanged ? 1 : 0) + gallery.Count(g => g.StartsWith("/api/media/"));
        }

        return moved;
    }
}
