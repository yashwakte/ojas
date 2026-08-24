using MongoDB.Bson;
using MongoDB.Driver;
using OjasApi.Models;

namespace OjasApi.Services;

/// <param name="ProductName">Which product ran short, for the customer-facing message.</param>
/// <param name="Available">How many were actually left.</param>
public record StockResult(bool Success, string? ProductName = null, int Available = 0)
{
    public static StockResult Ok() => new(true);
    public static StockResult Failed(string productName, int available) => new(false, productName, available);
}

public class ProductService
{
    private readonly IMongoDbService _db;

    public ProductService(IMongoDbService db)
    {
        _db = db;
    }

    public async Task<List<Product>> GetAllAsync() =>
        await _db.Products.Find(_ => true).ToListAsync();

    public async Task<Product?> GetByIdAsync(string id) =>
        await _db.Products.Find(p => p.Id == id).FirstOrDefaultAsync();

    /// <summary>
    /// What a product actually sells for: its list price less the discount advertised against it.
    /// This is the single definition of a product's price — the storefront shows it, and orders
    /// are charged it. They used to disagree, with the "20% OFF" badge shown to the customer
    /// while the full list price was what they were billed.
    /// </summary>
    public static decimal EffectivePrice(Product product) =>
        Math.Round(
            product.Price - product.Price * product.Discount / 100m,
            2,
            MidpointRounding.AwayFromZero);

    /// <summary>Looks up several products at once, keyed by id, so pricing an order is one query
    /// rather than one per line. Ids that aren't well-formed are simply absent from the result —
    /// the caller decides what an unknown product means.</summary>
    public async Task<Dictionary<string, Product>> GetByIdsAsync(IEnumerable<string> productIds)
    {
        var ids = productIds.Where(id => ObjectId.TryParse(id, out _)).Distinct().ToList();
        if (ids.Count == 0)
            return [];

        var products = await _db.Products
            .Find(Builders<Product>.Filter.In(p => p.Id, ids))
            .ToListAsync();

        return products.ToDictionary(p => p.Id!, StringComparer.Ordinal);
    }

    public async Task<List<Product>> GetByCategoryAsync(string category) =>
        await _db.Products.Find(p => p.Category == category).ToListAsync();

    public async Task<Product> CreateAsync(Product product)
    {
        await _db.Products.InsertOneAsync(product);
        return product;
    }

    public async Task<Product?> UpdateAsync(string id, UpdateProductRequest request)
    {
        var product = await GetByIdAsync(id);
        if (product == null)
            return null;

        if (request.Name != null) product.Name = request.Name;
        if (request.Description != null) product.Description = request.Description;
        if (request.Price.HasValue) product.Price = request.Price.Value;
        if (request.Discount.HasValue) product.Discount = request.Discount.Value;
        if (request.Category != null) product.Category = request.Category;
        if (request.ImageUrl != null) product.ImageUrl = request.ImageUrl;
        if (request.GalleryImageUrls != null) product.GalleryImageUrls = request.GalleryImageUrls;
        if (request.Weight != null) product.Weight = request.Weight;
        if (request.IsAvailable.HasValue) product.IsAvailable = request.IsAvailable.Value;
        if (request.StockQuantity.HasValue) product.StockQuantity = request.StockQuantity.Value;
        if (request.LowStockThreshold.HasValue) product.LowStockThreshold = request.LowStockThreshold.Value;
        if (request.Ingredients != null) product.Ingredients = request.Ingredients;
        if (request.Benefits != null) product.Benefits = request.Benefits;
        if (request.StorageInfo != null) product.StorageInfo = request.StorageInfo;

        product.UpdatedAt = DateTime.UtcNow;
        await _db.Products.ReplaceOneAsync(p => p.Id == id, product);
        return product;
    }

    public async Task<List<Product>> GetBestsellersAsync(int limit)
    {
        BsonDocument[] stages =
        [
            new BsonDocument("$unwind", "$items"),
            new BsonDocument("$group", new BsonDocument
            {
                { "_id", "$items.productId" },
                { "totalQty", new BsonDocument("$sum", "$items.quantity") },
            }),
            new BsonDocument("$sort", new BsonDocument("totalQty", -1)),
            new BsonDocument("$limit", limit),
        ];
        PipelineDefinition<Order, BsonDocument> pipeline = stages;

        var ranked = await _db.Orders.Aggregate(pipeline).ToListAsync();

        var products = new List<Product>();
        foreach (var doc in ranked)
        {
            var productId = doc["_id"].AsString;
            if (!ObjectId.TryParse(productId, out _)) continue;
            var product = await GetByIdAsync(productId);
            if (product != null && product.IsAvailable)
                products.Add(product);
        }

        // No real sales data yet: prefer the admin-curated fallback list over an arbitrary "newest products" guess.
        if (products.Count == 0)
        {
            var banners = await _db.CampaignBanners.Find(b => b.IsActive).SortBy(b => b.CreatedAt).ToListAsync();
            var fallbackIds = banners.SelectMany(b => b.FallbackBestsellerProductIds ?? []);
            foreach (var productId in fallbackIds)
            {
                if (products.Count >= limit) break;
                if (!ObjectId.TryParse(productId, out _)) continue;
                var product = await GetByIdAsync(productId);
                if (product != null && product.IsAvailable && products.All(p => p.Id != productId))
                    products.Add(product);
            }
        }

        if (products.Count < limit)
        {
            var excludeIds = products.Select(p => p.Id).ToHashSet();
            var backfill = await _db.Products
                .Find(p => p.IsAvailable && !excludeIds.Contains(p.Id))
                .SortByDescending(p => p.CreatedAt)
                .Limit(limit - products.Count)
                .ToListAsync();
            products.AddRange(backfill);
        }

        return products;
    }

    /// <summary>
    /// Atomically takes stock for an order. Each decrement is a single conditional
    /// update (`stockQuantity >= qty`), so two customers racing for the last packet
    /// cannot both win — the loser's update matches nothing. If any line fails,
    /// every line already taken in this call is put back before returning.
    /// Products with null stockQuantity are untracked and simply skipped.
    /// </summary>
    public async Task<StockResult> TryConsumeStockAsync(IEnumerable<(string ProductId, int Quantity, string ProductName)> items)
    {
        var taken = new List<(string ProductId, int Quantity)>();

        foreach (var (productId, quantity, productName) in items)
        {
            if (quantity <= 0) continue;
            // Product.Id is stored as an ObjectId, so a malformed id would throw while
            // the filter is serialized. Treat it as untracked rather than 500-ing.
            if (!ObjectId.TryParse(productId, out _)) continue;

            var filter = Builders<Product>.Filter.Eq(p => p.Id, productId)
                & Builders<Product>.Filter.Ne(p => p.StockQuantity, null)
                & Builders<Product>.Filter.Gte(p => p.StockQuantity, quantity);

            var result = await _db.Products.UpdateOneAsync(
                filter,
                Builders<Product>.Update.Inc(p => p.StockQuantity, -quantity));

            if (result.MatchedCount > 0)
            {
                taken.Add((productId, quantity));
                continue;
            }

            // Either the product is untracked (fine) or there isn't enough (not fine).
            var product = await GetByIdAsync(productId);
            if (product is null)
            {
                await RestoreStockAsync(taken);
                return StockResult.Failed(productName, 0);
            }

            if (product.StockQuantity is null) continue; // untracked

            await RestoreStockAsync(taken);
            return StockResult.Failed(product.Name, product.StockQuantity.Value);
        }

        return StockResult.Ok();
    }

    /// <summary>Puts stock back — used on cancellation and when an edit reduces quantities.</summary>
    public async Task RestoreStockAsync(IEnumerable<(string ProductId, int Quantity)> items)
    {
        foreach (var (productId, quantity) in items)
        {
            if (quantity <= 0) continue;
            if (!ObjectId.TryParse(productId, out _)) continue;
            await _db.Products.UpdateOneAsync(
                Builders<Product>.Filter.Eq(p => p.Id, productId)
                    & Builders<Product>.Filter.Ne(p => p.StockQuantity, null),
                Builders<Product>.Update.Inc(p => p.StockQuantity, quantity));
        }
    }

    /// <summary>Tracked products at or below their low-stock threshold, neediest first.</summary>
    public async Task<List<Product>> GetLowStockAsync()
    {
        var tracked = await _db.Products
            .Find(Builders<Product>.Filter.Ne(p => p.StockQuantity, null))
            .ToListAsync();

        return tracked
            .Where(p => p.StockQuantity!.Value <= p.LowStockThreshold)
            .OrderBy(p => p.StockQuantity!.Value)
            .ToList();
    }

    public async Task<bool> DeleteAsync(string id)
    {
        var result = await _db.Products.DeleteOneAsync(p => p.Id == id);
        return result.DeletedCount > 0;
    }

    public async Task SeedAsync(List<Product> products)
    {
        var count = await _db.Products.CountDocumentsAsync(_ => true);
        if (count == 0)
        {
            await _db.Products.InsertManyAsync(products);
        }
    }

    public async Task MigrateLegacyProductsAsync()
    {
        var filter = Builders<Product>.Filter;
        var update = Builders<Product>.Update;

        await _db.Products.UpdateManyAsync(
            filter.Exists("discount", false),
            update.Set(p => p.Discount, 0));
        await _db.Products.UpdateManyAsync(
            filter.Exists("ingredients", false),
            update.Set(p => p.Ingredients, "See the product description for ingredient details."));
        await _db.Products.UpdateManyAsync(
            filter.Exists("benefits", false),
            update.Set(p => p.Benefits, "See the product description for nutritional and usage benefits."));
        await _db.Products.UpdateManyAsync(
            filter.Exists("storageInfo", false),
            update.Set(p => p.StorageInfo, "Store in a cool, dry place in an airtight container."));
        await _db.Products.UpdateManyAsync(
            filter.Exists("updatedAt", false),
            update.Set(p => p.UpdatedAt, DateTime.UtcNow));
        await _db.Products.UpdateManyAsync(
            filter.Exists("galleryImageUrls", false),
            update.Set(p => p.GalleryImageUrls, new List<string>()));

        // Give existing products a threshold but deliberately NOT a stockQuantity:
        // leaving it absent (null) keeps them untracked and purchasable until an
        // admin enters a real count, rather than silently marking the shop empty.
        await _db.Products.UpdateManyAsync(
            filter.Exists("lowStockThreshold", false),
            update.Set(p => p.LowStockThreshold, 5));

        var fastingProductNames = new[]
        {
            "Buckwheat Flour",
            "Upvas Bhajani",
            "Shingada Flour",
            "Rajgira (Amaranth) Flour",
        };
        await _db.Products.UpdateManyAsync(
            filter.In(p => p.Name, fastingProductNames) & filter.Eq(p => p.Category, "Flour"),
            update.Set(p => p.Category, "Upwas"));
    }
}
