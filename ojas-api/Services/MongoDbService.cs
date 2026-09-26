using Microsoft.Extensions.Options;
using MongoDB.Bson;
using MongoDB.Driver;
using OjasApi.Models;

namespace OjasApi.Services;

public class MongoDbService : IMongoDbService
{
    private readonly IMongoDatabase _database;
    private readonly ILogger<MongoDbService> _logger;

    public MongoDbService(IOptions<MongoDbSettings> settings, ILogger<MongoDbService> logger)
    {
        _logger = logger;
        var mongoSettings = MongoClientSettings.FromConnectionString(settings.Value.ConnectionString);
        mongoSettings.ConnectTimeout = TimeSpan.FromSeconds(30);
        mongoSettings.ServerSelectionTimeout = TimeSpan.FromSeconds(30);
        var client = new MongoClient(mongoSettings);
        _database = client.GetDatabase(settings.Value.DatabaseName);

        TryEnsureIndexes();
    }

    public IMongoCollection<Product> Products => _database.GetCollection<Product>("products");
    public IMongoCollection<User> Users => _database.GetCollection<User>("users");
    public IMongoCollection<Order> Orders => _database.GetCollection<Order>("orders");
    public IMongoCollection<ReturnRequest> ReturnRequests => _database.GetCollection<ReturnRequest>("return_requests");
    public IMongoCollection<DeliveryCharges> DeliveryCharges => _database.GetCollection<DeliveryCharges>("delivery_charges");
    public IMongoCollection<CampaignBanner> CampaignBanners => _database.GetCollection<CampaignBanner>("campaign_banner");
    public IMongoCollection<HeroSlide> HeroSlides => _database.GetCollection<HeroSlide>("hero_slides");
    public IMongoCollection<OtpCode> OtpCodes => _database.GetCollection<OtpCode>("otp_codes");
    public IMongoCollection<RefreshToken> RefreshTokens => _database.GetCollection<RefreshToken>("refresh_tokens");
    public IMongoCollection<UsedPhoneToken> UsedPhoneTokens => _database.GetCollection<UsedPhoneToken>("used_phone_tokens");
    public IMongoCollection<StaffDevice> StaffDevices => _database.GetCollection<StaffDevice>("staff_devices");
    public IMongoCollection<StaffInvite> StaffInvites => _database.GetCollection<StaffInvite>("staff_invites");
    public IMongoCollection<WalletTransaction> WalletTransactions => _database.GetCollection<WalletTransaction>("wallet_transactions");
    // Keyed by user id, so every read and write is an _id lookup and needs no index of its own.
    public IMongoCollection<Cart> Carts => _database.GetCollection<Cart>("carts");
    public IMongoCollection<ProductReview> ProductReviews => _database.GetCollection<ProductReview>("product_reviews");
    public IMongoCollection<MediaAsset> MediaAssets => _database.GetCollection<MediaAsset>("media_assets");
    public IMongoCollection<AppMigration> AppMigrations => _database.GetCollection<AppMigration>("app_migrations");

    private void TryEnsureIndexes()
    {
        try
        {
            // Serves GetByCategoryAsync, which every category-filtered storefront request
            // hits. No index existed on Products at all before this - harmless at today's
            // ~13 products, but a full collection scan on every category browse is exactly
            // the kind of thing that stops being harmless once the catalog actually grows.
            var productCategoryIndex = new CreateIndexModel<Product>(
                Builders<Product>.IndexKeys.Ascending(p => p.Category),
                new CreateIndexOptions { Name = "product_category" }
            );
            Products.Indexes.CreateOne(productCategoryIndex);

            // Serves every product page, which is looked up by its readable address
            // (/products/modak-pith). Unique, so two products can never answer to one address;
            // partial, so products not yet given one - the moments before the boot backfill runs -
            // do not all collide on "no slug".
            var productSlugIndex = new CreateIndexModel<Product>(
                Builders<Product>.IndexKeys.Ascending(p => p.Slug),
                new CreateIndexOptions<Product>
                {
                    Name = "product_slug",
                    Unique = true,
                    PartialFilterExpression = Builders<Product>.Filter.Type(p => p.Slug, BsonType.String),
                }
            );
            Products.Indexes.CreateOne(productSlugIndex);

            var emailIndex = new CreateIndexModel<User>(
                Builders<User>.IndexKeys.Ascending(u => u.Email),
                new CreateIndexOptions { Unique = true, Name = "unique_email" }
            );
            var phoneIndex = new CreateIndexModel<User>(
                Builders<User>.IndexKeys.Ascending(u => u.Phone),
                new CreateIndexOptions { Unique = true, Name = "unique_phone" }
            );
            Users.Indexes.CreateMany([emailIndex, phoneIndex]);

            // TTL index - Mongo automatically deletes an OTP document once ExpiresAt is in the
            // past, so the collection self-cleans instead of growing unbounded.
            var otpTtlIndex = new CreateIndexModel<OtpCode>(
                Builders<OtpCode>.IndexKeys.Ascending(o => o.ExpiresAt),
                new CreateIndexOptions { ExpireAfter = TimeSpan.Zero, Name = "otp_ttl" }
            );
            OtpCodes.Indexes.CreateOne(otpTtlIndex);

            var refreshTokenTtlIndex = new CreateIndexModel<RefreshToken>(
                Builders<RefreshToken>.IndexKeys.Ascending(r => r.ExpiresAt),
                new CreateIndexOptions { ExpireAfter = TimeSpan.Zero, Name = "refresh_token_ttl" }
            );
            var refreshTokenUserIdIndex = new CreateIndexModel<RefreshToken>(
                Builders<RefreshToken>.IndexKeys.Ascending(r => r.UserId),
                new CreateIndexOptions { Name = "refresh_token_user_id" }
            );
            // Revoking a session deletes every token descended from one sign-in, which is a
            // query by family rather than by id - without this it would scan the collection on
            // every logout and on every detected token replay.
            var refreshTokenFamilyIndex = new CreateIndexModel<RefreshToken>(
                Builders<RefreshToken>.IndexKeys.Ascending(r => r.FamilyId),
                new CreateIndexOptions { Name = "refresh_token_family" }
            );
            RefreshTokens.Indexes.CreateMany([refreshTokenTtlIndex, refreshTokenUserIdIndex, refreshTokenFamilyIndex]);

            // A redeemed MSG91 token only has to be remembered for as long as it could still be
            // presented; Mongo drops the row after that. The _id is the token's hash, so the
            // uniqueness that makes a second redemption fail needs no index of its own.
            var usedPhoneTokenTtlIndex = new CreateIndexModel<UsedPhoneToken>(
                Builders<UsedPhoneToken>.IndexKeys.Ascending(t => t.ExpiresAt),
                new CreateIndexOptions { ExpireAfter = TimeSpan.Zero, Name = "used_phone_token_ttl" }
            );
            UsedPhoneTokens.Indexes.CreateOne(usedPhoneTokenTtlIndex);

            // Every wallet statement reads one customer's rows newest-first, so index the pair
            // rather than the user alone - this collection only ever grows.
            var walletUserIndex = new CreateIndexModel<WalletTransaction>(
                Builders<WalletTransaction>.IndexKeys
                    .Ascending(w => w.UserId)
                    .Descending(w => w.CreatedAt),
                new CreateIndexOptions { Name = "wallet_user_created" }
            );
            WalletTransactions.Indexes.CreateOne(walletUserIndex);

            // Every image request is a lookup by hash, and the uniqueness is what makes the
            // store content-addressed: the same picture uploaded twice collapses to one row
            // rather than quietly accumulating duplicates of a multi-megabyte blob.
            var mediaHashIndex = new CreateIndexModel<MediaAsset>(
                Builders<MediaAsset>.IndexKeys.Ascending(m => m.Hash),
                new CreateIndexOptions { Unique = true, Name = "media_hash" }
            );
            MediaAssets.Indexes.CreateOne(mediaHashIndex);

            // userId leads the key so this one index serves both access patterns: "is this user
            // bound to this device" on every staff login and refresh, and "which device does
            // this user have" for the admin listing and for replacing an old binding. Unique,
            // because a user must never accumulate two rows for the same device.
            var staffDeviceIndex = new CreateIndexModel<StaffDevice>(
                Builders<StaffDevice>.IndexKeys
                    .Ascending(d => d.UserId)
                    .Ascending(d => d.DeviceIdHash),
                new CreateIndexOptions { Unique = true, Name = "staff_device_user_and_device" }
            );
            StaffDevices.Indexes.CreateOne(staffDeviceIndex);

            // An unused invite should not linger indefinitely - Mongo drops it once it expires.
            var staffInviteTtlIndex = new CreateIndexModel<StaffInvite>(
                Builders<StaffInvite>.IndexKeys.Ascending(i => i.ExpiresAt),
                new CreateIndexOptions { ExpireAfter = TimeSpan.Zero, Name = "staff_invite_ttl" }
            );
            var staffInviteUserIdIndex = new CreateIndexModel<StaffInvite>(
                Builders<StaffInvite>.IndexKeys.Ascending(i => i.UserId),
                new CreateIndexOptions { Name = "staff_invite_user_id" }
            );
            StaffInvites.Indexes.CreateMany([staffInviteTtlIndex, staffInviteUserIdIndex]);
        }
        catch (MongoCommandException ex)
        {
            _logger.LogWarning(
                "Could not create unique indexes on users collection: {Message}. " +
                "Remove duplicate email/phone entries from the database to enforce uniqueness.",
                ex.Message);
        }

        // Reviews: the product page's read (a product's visible reviews, newest first) and the
        // newest-first admin list. The one-review-per-purchase unique index is built at boot by
        // ReviewService.CollapseDuplicatesAndRebuildRatingsAsync, after any duplicates an earlier
        // build allowed have been collapsed - it cannot be created while they exist.
        try
        {
            // Earlier builds' unique indexes allowed one review per customer per product; the rule
            // is one per purchase, so neither may survive - either would refuse the review of a
            // second purchase of the same product.
            foreach (var stale in new[] { "review_user_product", "review_one_per_customer_product" })
            {
                try { ProductReviews.Indexes.DropOne(stale); }
                catch (MongoCommandException) { /* never built here */ }
            }

            ProductReviews.Indexes.CreateMany([
                new CreateIndexModel<ProductReview>(
                    Builders<ProductReview>.IndexKeys
                        .Ascending(r => r.ProductId)
                        .Ascending(r => r.IsHidden)
                        .Descending(r => r.CreatedAt),
                    new CreateIndexOptions { Name = "review_product_visible_newest" }),
                new CreateIndexModel<ProductReview>(
                    Builders<ProductReview>.IndexKeys.Descending(r => r.CreatedAt),
                    new CreateIndexOptions { Name = "review_newest" }),
            ]);
        }
        catch (MongoCommandException ex)
        {
            _logger.LogWarning("Could not create review indexes: {Message}.", ex.Message);
        }
    }
}
