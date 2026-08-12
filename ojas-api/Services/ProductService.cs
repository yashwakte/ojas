using MongoDB.Bson;
using MongoDB.Driver;
using OjasApi.Models;

namespace OjasApi.Services;

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
            var banner = await _db.CampaignBanners.Find(_ => true).FirstOrDefaultAsync();
            foreach (var productId in banner?.FallbackBestsellerProductIds ?? [])
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
