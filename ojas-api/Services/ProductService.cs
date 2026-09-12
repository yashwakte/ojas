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
    /// <summary>
    /// Ledger key for the one-time alignment of every listing's price and net weight with the
    /// printed pack. Changing this string would run that correction again and overwrite the
    /// owner's own pricing, so it is a constant and must stay exactly as it is.
    /// </summary>
    private const string PackFactsMigrationId = "product-pack-facts-2026-09";

    private readonly IMongoDbService _db;

    public ProductService(IMongoDbService db)
    {
        _db = db;
    }

    /// <param name="includeUnlisted">
    /// Admin only. An unlisted product is one the owner has not finished setting up — typically a
    /// new pack that has photographs and copy but no price yet — and it must never reach a
    /// customer, because the only price it could be shown at is zero. The admin console is the one
    /// caller that has to see them, which is the whole point of them existing.
    /// </param>
    public async Task<List<Product>> GetAllAsync(bool includeUnlisted = false) =>
        await _db.Products.Find(includeUnlisted ? Builders<Product>.Filter.Empty : Listed).ToListAsync();

    /// <inheritdoc cref="GetAllAsync"/>
    public async Task<Product?> GetByIdAsync(string id, bool includeUnlisted = true) =>
        await _db.Products
            .Find(includeUnlisted
                ? Builders<Product>.Filter.Eq(p => p.Id, id)
                : Builders<Product>.Filter.Eq(p => p.Id, id) & Listed)
            .FirstOrDefaultAsync();

    /// <summary>
    /// Products a customer may see. Written as "not explicitly unlisted" rather than "isListed is
    /// true" so that every document written before the field existed still matches — a plain
    /// equality filter would hide the entire live catalogue the moment this shipped.
    /// </summary>
    private static FilterDefinition<Product> Listed =>
        Builders<Product>.Filter.Ne(p => p.IsListed, false);

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
        await _db.Products
            .Find(Builders<Product>.Filter.Eq(p => p.Category, category) & Listed)
            .ToListAsync();

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
        if (request.IsListed.HasValue) product.IsListed = request.IsListed.Value;
        if (request.StockQuantity.HasValue)
            product.StockQuantity = Product.NormalizeStockQuantity(request.StockQuantity);
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
            var product = await GetByIdAsync(productId, includeUnlisted: false);
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
                var product = await GetByIdAsync(productId, includeUnlisted: false);
                if (product != null && product.IsAvailable && products.All(p => p.Id != productId))
                    products.Add(product);
            }
        }

        if (products.Count < limit)
        {
            var excludeIds = products.Select(p => p.Id).ToHashSet();
            var backfill = await _db.Products
                .Find(Builders<Product>.Filter.Where(p => p.IsAvailable && !excludeIds.Contains(p.Id)) & Listed)
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

    /// <param name="packData">
    /// The catalogue as printed on the packs (<see cref="Data.SeedData.GetProducts"/>). Passed in
    /// rather than referenced directly so this service keeps knowing nothing about seed data, and
    /// so the same list is the single source of truth for both a fresh install and a backfill.
    /// </param>
    public async Task MigrateLegacyProductsAsync(List<Product>? packData = null)
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

        await RecategoriseCatalogueAsync();

        if (packData is not null)
        {
            await IntroduceNewProductsAsync(packData);
            await BackfillPackContentAsync(packData);
        }
    }

    /// <summary>
    /// The categories retired in September 2026, and where a product in one goes when nothing
    /// more specific is known about it. Premium Atta was empty, Grains held a single product, and
    /// Powder Box named the packaging rather than what was in it, so custard sat beside cinnamon
    /// and citric acid. The storefront keeps the same table (LEGACY_CATEGORY_NAMES) for links.
    /// </summary>
    internal static readonly IReadOnlyDictionary<string, string> RetiredCategories =
        new Dictionary<string, string>
        {
            ["Flour"] = "Everyday Flours",
            ["Premium Atta"] = "Everyday Flours",
            ["Grains"] = "Health & Breakfast",
            ["Health Mix"] = "Health & Breakfast",
            ["Powder Box"] = "Baking & Desserts",
        };

    /// <summary>
    /// The aisle each catalogue product belongs in, for the products whose old category was too
    /// broad to translate on its own: Flour held both everyday millet flours and festive ones,
    /// and Powder Box held baking goods, salts and spices.
    /// </summary>
    internal static readonly IReadOnlyDictionary<string, string> CategoryByProductName =
        new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase)
        {
            ["Sorghum Flour"] = "Everyday Flours",
            ["Bajra Flour"] = "Everyday Flours",
            ["Ragi Flour"] = "Everyday Flours",
            ["Rice Flour"] = "Everyday Flours",
            ["Modak Pith"] = "Traditional & Festive",
            ["Anarasa Flour"] = "Traditional & Festive",
            ["Thalipeeth Bhajani"] = "Traditional & Festive",
            ["Amboli (Ghavan) Flour"] = "Traditional & Festive",
            ["Rajgira (Amaranth) Flour"] = "Upwas",
            ["Buckwheat Flour"] = "Upwas",
            ["Shingada Flour"] = "Upwas",
            ["Upvas Bhajani"] = "Upwas",
            ["Bhagar (Varai) Peeth"] = "Upwas",
            // Sendha namak is the fasting salt; the client's own Upwas poster puts it with the
            // fasting flours.
            ["Rock Salt"] = "Upwas",
            ["Wheat Daliya"] = "Health & Breakfast",
            ["Chana Sattu"] = "Health & Breakfast",
            ["Ragi Malt (Sprouted)"] = "Health & Breakfast",
            ["Custard Powder - Vanilla Flavour"] = "Baking & Desserts",
            ["Custard Powder - Mango Flavour"] = "Baking & Desserts",
            ["Custard Powder - Strawberry Flavour"] = "Baking & Desserts",
            ["Custard Powder - Pineapple Flavour"] = "Baking & Desserts",
            ["Corn Flour"] = "Baking & Desserts",
            ["Baking Powder"] = "Baking & Desserts",
            ["Baking Soda"] = "Baking & Desserts",
            ["Cocoa Powder"] = "Baking & Desserts",
            ["Active Dry Yeast"] = "Baking & Desserts",
            ["Black Salt"] = "Spices & Essentials",
            ["Citric Acid"] = "Spices & Essentials",
            ["Monosodium Glutamate"] = "Spices & Essentials",
            ["Dry Ginger Powder"] = "Spices & Essentials",
            ["Cinnamon Powder"] = "Spices & Essentials",
            ["Jeshthamadh (Sweet Root) Powder"] = "Spices & Essentials",
        };

    /// <summary>
    /// Moves every product still filed under a retired category into its new aisle.
    ///
    /// Only retired values are ever touched, which is what makes it safe to run on every boot: a
    /// category the owner picks in the admin console is one of the new ones, so it is never
    /// second-guessed here. A product this table does not know by name - one the owner added
    /// themselves - follows its old category's default. The filter on the old value in each
    /// update means an edit that lands between the read and the write wins.
    /// </summary>
    private async Task RecategoriseCatalogueAsync()
    {
        var filter = Builders<Product>.Filter;

        var stale = await _db.Products
            .Find(filter.In(p => p.Category, RetiredCategories.Keys))
            .ToListAsync();
        if (stale.Count == 0) return;

        var moves = stale
            .Select(p => new UpdateOneModel<Product>(
                filter.Eq(x => x.Id, p.Id) & filter.Eq(x => x.Category, p.Category),
                Builders<Product>.Update.Set(
                    x => x.Category,
                    CategoryByProductName.TryGetValue(p.Name, out var aisle)
                        ? aisle
                        : RetiredCategories[p.Category])))
            .ToList();

        await _db.Products.BulkWriteAsync(moves);
        Console.WriteLine($"✅ {moves.Count} product(s) moved into the new catalogue categories.");
    }

    /// <summary>
    /// Inserts catalogue products that the live database has never seen.
    ///
    /// <see cref="SeedAsync"/> cannot do this — it only ever runs against an empty collection, so
    /// a shop that has been open for a day will never see another product added to the seed again.
    /// Every pack the client photographs from now on would have to be retyped into the admin
    /// console by hand, label and all, which is exactly the work the seed already did once.
    ///
    /// Matching is by name and insert-only: a product that exists is left completely alone, so
    /// this can never overwrite the owner's pricing, copy or photography. New arrivals normally
    /// come in unlisted and unpriced (Price = 0, IsListed = false), which keeps them off the
    /// storefront until the owner sets a price — see the tail of SeedData.
    /// </summary>
    private async Task IntroduceNewProductsAsync(List<Product> packData)
    {
        var existing = await _db.Products
            .Find(_ => true)
            .Project(p => p.Name)
            .ToListAsync();
        var known = new HashSet<string>(existing, StringComparer.OrdinalIgnoreCase);

        var arrivals = packData.Where(p => !known.Contains(p.Name)).ToList();
        if (arrivals.Count == 0) return;

        // Ids come from the seed objects as null, so Mongo assigns them; CreatedAt is stamped by
        // the model. Nothing here is reused between boots, so a partial failure just means the
        // remainder arrive on the next start.
        await _db.Products.InsertManyAsync(arrivals);

        var unpriced = arrivals.Count(p => p.Price == 0);
        Console.WriteLine(
            $"✅ {arrivals.Count} new product(s) added to the catalogue"
            + (unpriced > 0 ? $", {unpriced} of them unlisted and awaiting a price." : "."));
        foreach (var product in arrivals)
        {
            Console.WriteLine($"   new     {product.Name} ({product.Weight})"
                + (product.Price == 0 ? "  — needs a price before it can be listed" : ""));
        }
    }

    /// <summary>
    /// Copies what is printed on each pack — ingredients, nutrition and directions, storage, and
    /// the front and back photographs — onto products that already exist.
    ///
    /// Seeding cannot do this: <see cref="SeedAsync"/> only ever runs against an empty collection,
    /// so a shop that has been live for a day never sees a change to the seed again. Every product
    /// the client has since photographed and labelled would stay blank forever without this.
    ///
    /// It fills gaps and never overwrites real content. A field is considered a gap if it is empty
    /// or still holds one of the generic placeholders written by the earlier migration above — an
    /// admin who has typed their own copy keeps it. Likewise the image is only replaced while it is
    /// still the old low-resolution .jpg mockup, so an uploaded photograph is never clobbered.
    ///
    /// Price and net weight are corrected too, but ONCE and only once — see
    /// <see cref="PackFactsMigrationId"/>. Several live listings were priced above the MRP printed
    /// on the pack and described as 500 g where the pack holds 200 g. The owner asked for both to
    /// be brought in line with the labels.
    /// </summary>
    private async Task BackfillPackContentAsync(List<Product> packData)
    {
        // Price and weight are editable from the admin dashboard, so correcting them has to be a
        // one-shot. Re-asserting the pack figures on every boot would silently undo an owner who
        // repriced something in the dashboard — they would change a price, restart the API, and
        // watch it spring back with no explanation. The ledger entry is what makes it one-shot.
        var alreadyPriced = await _db.AppMigrations
            .Find(m => m.Id == PackFactsMigrationId)
            .AnyAsync();

        // Written by the earlier migration for products that predate these fields. Treated as
        // "still empty" — they say nothing, and leaving them would defeat the whole backfill.
        string[] placeholders =
        [
            "See the product description for ingredient details.",
            "See the product description for nutritional and usage benefits.",
            "Store in a cool, dry place in an airtight container.",
        ];

        static bool IsGap(string? value, string[] placeholders) =>
            string.IsNullOrWhiteSpace(value) || placeholders.Contains(value.Trim());

        var existing = await _db.Products.Find(_ => true).ToListAsync();
        var byName = packData.ToDictionary(p => p.Name, StringComparer.OrdinalIgnoreCase);

        var writes = new List<WriteModel<Product>>();
        var repriced = new List<string>();
        var reweighed = new List<string>();

        foreach (var product in existing)
        {
            if (!byName.TryGetValue(product.Name, out var pack)) continue;

            var sets = new List<UpdateDefinition<Product>>();

            if (IsGap(product.Ingredients, placeholders) && !string.IsNullOrWhiteSpace(pack.Ingredients))
                sets.Add(Builders<Product>.Update.Set(p => p.Ingredients, pack.Ingredients));

            if (IsGap(product.Benefits, placeholders) && !string.IsNullOrWhiteSpace(pack.Benefits))
                sets.Add(Builders<Product>.Update.Set(p => p.Benefits, pack.Benefits));

            if (IsGap(product.StorageInfo, placeholders) && !string.IsNullOrWhiteSpace(pack.StorageInfo))
                sets.Add(Builders<Product>.Update.Set(p => p.StorageInfo, pack.StorageInfo));

            // Only upgrade the old bundled mockups. Anything else is a deliberate choice.
            var onOldMockup =
                string.IsNullOrWhiteSpace(product.ImageUrl)
                || product.ImageUrl.EndsWith(".jpg", StringComparison.OrdinalIgnoreCase)
                || product.ImageUrl.EndsWith(".svg", StringComparison.OrdinalIgnoreCase);

            if (onOldMockup && !string.IsNullOrWhiteSpace(pack.ImageUrl))
                sets.Add(Builders<Product>.Update.Set(p => p.ImageUrl, pack.ImageUrl));

            // The back of the pack is where ingredients and directions are printed, so it belongs
            // in the gallery whatever the front image is. Added, not replaced: an admin may have
            // uploaded other angles, and this must not throw them away.
            var gallery = product.GalleryImageUrls ?? [];
            var missingBacks = pack.GalleryImageUrls.Where(url => !gallery.Contains(url)).ToList();
            if (missingBacks.Count > 0)
                sets.Add(Builders<Product>.Update.Set(p => p.GalleryImageUrls, [.. gallery, .. missingBacks]));

            // A pack price of zero means the owner has not set one yet, not that the pack is free.
            // Neither the one-off correction nor the drift warning below has anything to say about
            // a product in that state.
            if (!alreadyPriced && pack.Price > 0)
            {
                // The printed MRP is the ceiling, so this only ever lowers a price. A discount
                // set in the dashboard still applies on top, which keeps the selling price below
                // MRP — exactly where it is allowed to be.
                if (product.Price != pack.Price)
                {
                    repriced.Add($"{product.Name}: ₹{product.Price} -> ₹{pack.Price}");
                    sets.Add(Builders<Product>.Update.Set(p => p.Price, pack.Price));
                }

                if (!string.Equals(product.Weight, pack.Weight, StringComparison.OrdinalIgnoreCase))
                {
                    reweighed.Add($"{product.Name}: {product.Weight} -> {pack.Weight}");
                    sets.Add(Builders<Product>.Update.Set(p => p.Weight, pack.Weight));
                }
            }

            if (sets.Count == 0) continue;

            sets.Add(Builders<Product>.Update.Set(p => p.UpdatedAt, DateTime.UtcNow));
            writes.Add(new UpdateOneModel<Product>(
                Builders<Product>.Filter.Eq(p => p.Id, product.Id),
                Builders<Product>.Update.Combine(sets)));
        }

        if (writes.Count > 0)
        {
            await _db.Products.BulkWriteAsync(writes);
        }

        if (!alreadyPriced)
        {
            // Written whether or not anything needed changing. The point of the ledger is "this
            // correction has been considered", not "this correction changed rows" — recording it
            // only when there was work to do would leave a fresh database eligible forever.
            await _db.AppMigrations.InsertOneAsync(new AppMigration
            {
                Id = PackFactsMigrationId,
                Note =
                    $"Aligned price and net weight with the printed packs. "
                    + $"{repriced.Count} repriced, {reweighed.Count} reweighed.",
            });

            // Logged in full: this changed what customers are charged, so there needs to be a
            // record of exactly what moved and in which direction.
            foreach (var line in repriced) Console.WriteLine($"   price   {line}");
            foreach (var line in reweighed) Console.WriteLine($"   weight  {line}");
            Console.WriteLine(
                $"✅ Pack facts applied: {repriced.Count} prices, {reweighed.Count} weights.");
        }
        else
        {
            // The correction is spent, so from here this is pure drift detection: it reports a
            // listing that has since been edited back above the printed MRP, or away from the
            // printed net weight, and changes nothing. Worth saying out loud on every boot —
            // selling above MRP is an offence under the Legal Metrology rules, and it is the kind
            // of mistake that is invisible in the dashboard until someone complains.
            foreach (var product in existing)
            {
                if (!byName.TryGetValue(product.Name, out var pack)) continue;
                if (pack.Price <= 0) continue;

                if (product.Price > pack.Price)
                {
                    Console.WriteLine(
                        $"⚠️  '{product.Name}' is listed at ₹{product.Price} but the pack MRP is ₹{pack.Price}.");
                }
                if (!string.Equals(product.Weight, pack.Weight, StringComparison.OrdinalIgnoreCase))
                {
                    Console.WriteLine(
                        $"⚠️  '{product.Name}' is listed as {product.Weight} but the pack is {pack.Weight}.");
                }
            }
        }
    }
}
