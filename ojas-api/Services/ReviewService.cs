using System.Text;
using MongoDB.Bson;
using MongoDB.Driver;
using OjasApi.Models;

namespace OjasApi.Services;

/// <summary>A product's reviews as the storefront shows them: the average, how the stars are
/// spread, and the newest reviews themselves.</summary>
public record ProductReviewSummary(double Average, int Count, int[] Distribution);

/// <summary>
/// Product reviews: who may write one, what the storefront shows, and the admin's power to take
/// one down.
///
/// The one rule everything else hangs off is that a review needs a delivered order with the
/// product on it. It is checked here, on every write, against the orders collection - never
/// against anything the browser says it bought.
/// </summary>
public class ReviewService(
    IMongoDbService db,
    OrderService orderService,
    ProductService productService)
{
    /// <summary>How many reviews one page of a product's list carries. A product with two hundred
    /// reviews is read ten at a time ("Show more"), never loaded whole; the summary above them
    /// counts every review, not only the loaded ones.</summary>
    public const int ProductPageSize = 10;

    /// <summary>The most one request may ask for.</summary>
    public const int ProductPageMax = 20;

    /// <summary>How many "top reviews" lead the product page: its best, picked the same way the
    /// home wall picks a customer's best.</summary>
    public const int TopReviewCount = 2;

    /// <summary>How many the home page's review wall shows at most.</summary>
    public const int FeaturedLimit = 8;

    /// <summary>A home-page review has to say something. Stars alone are a fine review on a
    /// product page and an empty card on the home page; "Fantastic taste" is enough.</summary>
    public const int FeaturedMinCommentLength = 10;

    private readonly IMongoCollection<ProductReview> _reviews = db.ProductReviews;

    private static FilterDefinition<ProductReview> Visible =>
        Builders<ProductReview>.Filter.Eq(r => r.IsHidden, false);

    /// <summary>
    /// A product's reviews for its page: the summary over all of them, the best
    /// <see cref="TopReviewCount"/> (first page only), and one page of the rest, newest first.
    /// </summary>
    public async Task<(ProductReviewSummary Summary, List<ProductReview> Top, List<ProductReview> Reviews)>
        GetForProductAsync(string productId, int skip = 0, int take = ProductPageSize)
    {
        if (!ObjectId.TryParse(productId, out _))
            return (EmptySummary, [], []);

        var filter = ProductFilter(productId);
        var summary = await GetSummaryAsync(productId);

        skip = Math.Max(0, skip);
        take = Math.Clamp(take, 1, ProductPageMax);
        var reviews = summary.Count == 0 || skip >= summary.Count
            ? []
            : await _reviews.Find(filter)
                .SortByDescending(r => r.CreatedAt)
                .Skip(skip)
                .Limit(take)
                .ToListAsync();

        // Best first: most stars, then the one that says the most, then the newest. Ranked in the
        // database - a product with thousands of reviews still sends two.
        var top = skip > 0 || summary.Count == 0
            ? []
            : await _reviews.Aggregate()
                .Match(filter)
                .AppendStage<ProductReview>(new BsonDocument("$addFields",
                    new BsonDocument("commentLength", new BsonDocument("$strLenCP", "$comment"))))
                .Sort(new BsonDocumentSortDefinition<ProductReview>(new BsonDocument
                {
                    { "rating", -1 },
                    { "commentLength", -1 },
                    { "createdAt", -1 },
                }))
                .Limit(TopReviewCount)
                .ToListAsync();

        return (summary, top, reviews);
    }

    private static ProductReviewSummary EmptySummary => new(0, 0, new int[ProductReview.MaxRating]);

    private static FilterDefinition<ProductReview> ProductFilter(string productId) =>
        Builders<ProductReview>.Filter.Eq(r => r.ProductId, productId) & Visible;

    /// <summary>The average and the spread of stars over every public review of a product.</summary>
    public async Task<ProductReviewSummary> GetSummaryAsync(string productId)
    {
        if (!ObjectId.TryParse(productId, out _)) return EmptySummary;
        var filter = ProductFilter(productId);

        // The spread is counted in the database rather than from the page of reviews loaded
        // below it, so the average is over every review, however many there come to be.
        var buckets = await _reviews.Aggregate()
            .Match(filter)
            .Group(r => r.Rating, g => new { Rating = g.Key, Count = g.Count() })
            .ToListAsync();

        var distribution = new int[ProductReview.MaxRating];
        foreach (var bucket in buckets)
        {
            if (bucket.Rating is >= ProductReview.MinRating and <= ProductReview.MaxRating)
                distribution[bucket.Rating - 1] = bucket.Count;
        }

        var count = distribution.Sum();
        var average = count == 0
            ? 0
            : Math.Round(distribution.Select((n, i) => n * (i + 1)).Sum() / (double)count, 1);

        return new ProductReviewSummary(average, count, distribution);
    }

    /// <summary>
    /// What the home page shows under "Loved by families": well-rated reviews that say something,
    /// ONE PER CUSTOMER - a customer who wrote several is represented by their best (most stars,
    /// then the fullest words, then the newest), so the wall is many families, not one family
    /// many times. The cards come highest-rated first, newest first within a rating.
    /// </summary>
    public async Task<List<ProductReview>> GetFeaturedAsync()
    {
        var candidates = await _reviews
            .Find(Visible
                & Builders<ProductReview>.Filter.Gte(r => r.Rating, 4)
                & Builders<ProductReview>.Filter.Ne(r => r.Comment, string.Empty))
            .SortByDescending(r => r.CreatedAt)
            .Limit(500)
            .ToListAsync();

        return candidates
            .Where(r => r.Comment.Trim().Length >= FeaturedMinCommentLength)
            .GroupBy(r => r.UserId, StringComparer.Ordinal)
            .Select(BestOf)
            .OrderByDescending(r => r.Rating)
            .ThenByDescending(r => r.CreatedAt)
            .Take(FeaturedLimit)
            .ToList();
    }

    /// <summary>A customer's strongest review for the home page: most stars, then the one that
    /// says the most, then the newest.</summary>
    private static ProductReview BestOf(IEnumerable<ProductReview> reviews) =>
        reviews
            .OrderByDescending(r => r.Rating)
            .ThenByDescending(r => r.Comment.Trim().Length)
            .ThenByDescending(r => r.CreatedAt)
            .First();

    /// <summary>This customer's reviews, including any an admin has hidden - they wrote it, so
    /// they are told where it stands.</summary>
    public async Task<List<ProductReview>> GetMineAsync(string userId) =>
        await _reviews.Find(r => r.UserId == userId)
            .SortByDescending(r => r.CreatedAt)
            .ToListAsync();

    /// <summary>Every product this customer has a delivered, not-yet-reviewed purchase of - the
    /// ones they may write a review for right now. A product reviewed from an earlier order comes
    /// back here when a new order of it is delivered.</summary>
    public async Task<List<string>> GetReviewableProductIdsAsync(string userId)
    {
        var orders = await orderService.GetOrdersByUserAsync(userId);
        var reviewed = await ReviewedPurchasesAsync(userId);
        return orders
            .Where(IsDelivered)
            .SelectMany(o => o.Items.Select(i => (o.Id!, i.ProductId)))
            .Where(purchase => !reviewed.Contains(purchase))
            .Select(purchase => purchase.Item2)
            .Distinct(StringComparer.Ordinal)
            .ToList();
    }

    /// <summary>(order, product) pairs this customer has already reviewed.</summary>
    private async Task<HashSet<(string OrderId, string ProductId)>> ReviewedPurchasesAsync(string userId)
    {
        var mine = await _reviews.Find(r => r.UserId == userId).ToListAsync();
        return mine.Select(r => (r.OrderId, r.ProductId)).ToHashSet();
    }

    public record WriteOutcome(ProductReview? Review, string? Error);

    public const string AlreadyReviewedMessage =
        "You have already reviewed this purchase. You can edit your review instead.";

    /// <summary>
    /// Posts the review for one purchase: a delivered order carrying the product that this
    /// customer has not reviewed yet. <paramref name="orderId"/> picks the purchase (the orders
    /// page sends it); without one, the earliest unreviewed delivered order is used.
    /// </summary>
    public async Task<WriteOutcome> CreateAsync(
        string userId, string productId, int rating, string? comment, string? orderId = null)
    {
        if (rating is < ProductReview.MinRating or > ProductReview.MaxRating)
            return new WriteOutcome(null, "Choose between one and five stars.");

        if (!ObjectId.TryParse(productId, out _))
            return new WriteOutcome(null, "Product not found.");

        var orders = await orderService.GetOrdersByUserAsync(userId);
        var delivered = orders
            .Where(IsDelivered)
            .Where(o => o.Items.Any(i => i.ProductId == productId))
            .OrderBy(o => o.CreatedAt)
            .ToList();
        if (delivered.Count == 0)
        {
            return new WriteOutcome(null,
                "You can review a product once an order with it has been delivered to you.");
        }

        var reviewed = await ReviewedPurchasesAsync(userId);
        var open = delivered.Where(o => !reviewed.Contains((o.Id!, productId))).ToList();
        var purchase = orderId == null ? open.FirstOrDefault() : open.FirstOrDefault(o => o.Id == orderId);
        if (purchase == null)
        {
            // Either every purchase is reviewed, or the order named is not one of theirs, not
            // delivered, or already reviewed - the customer's answer is the same.
            return new WriteOutcome(null, open.Count == 0 || delivered.Any(o => o.Id == orderId)
                ? AlreadyReviewedMessage
                : "That order is not one you can review this product for.");
        }

        var user = await db.Users.Find(u => u.Id == userId).FirstOrDefaultAsync();
        var product = await productService.GetByIdAsync(productId);

        var review = new ProductReview
        {
            ProductId = productId,
            ProductName = product?.Name
                ?? purchase.Items.First(i => i.ProductId == productId).ProductName,
            UserId = userId,
            OrderId = purchase.Id!,
            PurchasedAt = purchase.CreatedAt,
            AuthorName = ProductReview.PublicName(user?.FullName),
            Rating = rating,
            Comment = CleanComment(comment),
            CreatedAt = DateTime.UtcNow,
        };

        try
        {
            await _reviews.InsertOneAsync(review);
        }
        catch (MongoWriteException ex) when (ex.WriteError?.Category == ServerErrorCategory.DuplicateKey)
        {
            // A double-tapped Post racing itself: the unique index let the first one through.
            return new WriteOutcome(null, AlreadyReviewedMessage);
        }

        await RecomputeRatingAsync(productId);
        return new WriteOutcome(review, null);
    }

    /// <summary>
    /// Rewrites one of this customer's own reviews. A review an admin has hidden stays hidden:
    /// otherwise changing one word would be a way round the takedown.
    /// </summary>
    public async Task<WriteOutcome> UpdateMineAsync(string userId, string reviewId, int rating, string? comment)
    {
        if (rating is < ProductReview.MinRating or > ProductReview.MaxRating)
            return new WriteOutcome(null, "Choose between one and five stars.");
        if (!ObjectId.TryParse(reviewId, out _))
            return new WriteOutcome(null, "Review not found.");

        var updated = await _reviews.FindOneAndUpdateAsync(
            Builders<ProductReview>.Filter.Eq(r => r.Id, reviewId)
            & Builders<ProductReview>.Filter.Eq(r => r.UserId, userId),
            Builders<ProductReview>.Update
                .Set(r => r.Rating, rating)
                .Set(r => r.Comment, CleanComment(comment))
                .Set(r => r.UpdatedAt, DateTime.UtcNow),
            new FindOneAndUpdateOptions<ProductReview> { ReturnDocument = ReturnDocument.After });

        if (updated == null) return new WriteOutcome(null, "Review not found.");
        await RecomputeRatingAsync(updated.ProductId);
        return new WriteOutcome(updated, null);
    }

    public async Task<bool> DeleteMineAsync(string userId, string reviewId)
    {
        if (!ObjectId.TryParse(reviewId, out _)) return false;
        var removed = await _reviews.FindOneAndDeleteAsync(r => r.UserId == userId && r.Id == reviewId);
        if (removed == null) return false;
        await RecomputeRatingAsync(removed.ProductId);
        return true;
    }

    // ===== ADMIN =====

    /// <summary>The newest reviews, hidden ones included, for the moderation list.</summary>
    public async Task<List<ProductReview>> GetAllForAdminAsync(int limit = 300) =>
        await _reviews.Find(Builders<ProductReview>.Filter.Empty)
            .SortByDescending(r => r.CreatedAt)
            .Limit(limit)
            .ToListAsync();

    public async Task<ProductReview?> SetHiddenAsync(string id, bool hidden)
    {
        if (!ObjectId.TryParse(id, out _)) return null;

        var review = await _reviews.FindOneAndUpdateAsync(
            Builders<ProductReview>.Filter.Eq(r => r.Id, id),
            Builders<ProductReview>.Update.Set(r => r.IsHidden, hidden),
            new FindOneAndUpdateOptions<ProductReview> { ReturnDocument = ReturnDocument.After });
        if (review != null) await RecomputeRatingAsync(review.ProductId);
        return review;
    }

    /// <summary>
    /// Writes a product's average and review count onto the product, from its public reviews.
    /// Called after every change to a review, so the catalogue's stars match the product page's.
    /// </summary>
    public async Task RecomputeRatingAsync(string productId)
    {
        var summary = await GetSummaryAsync(productId);
        await db.Products.UpdateOneAsync(
            Builders<Product>.Filter.Eq(p => p.Id, productId),
            Builders<Product>.Update
                .Set(p => p.RatingAverage, summary.Average)
                .Set(p => p.RatingCount, summary.Count));
    }

    /// <summary>
    /// Run once at boot. An early build let one purchase be reviewed any number of times; the rule
    /// is one review per product per order. Where a purchase has several, the newest is kept - it
    /// is the customer's latest word - and the rest are removed. Then the one-per-purchase index is
    /// built (it cannot be while duplicates exist), reviews written before the purchase date was
    /// recorded get it from their order, and every reviewed product's rating is rewritten onto it.
    /// </summary>
    public async Task<int> CollapseDuplicatesAndRebuildRatingsAsync()
    {
        var all = await _reviews.Find(Builders<ProductReview>.Filter.Empty).ToListAsync();
        var extras = all
            .GroupBy(r => (r.UserId, r.ProductId, r.OrderId))
            .SelectMany(g => g.OrderByDescending(r => r.CreatedAt).Skip(1))
            .Select(r => r.Id!)
            .ToList();
        if (extras.Count > 0)
            await _reviews.DeleteManyAsync(Builders<ProductReview>.Filter.In(r => r.Id, extras));

        await _reviews.Indexes.CreateOneAsync(new CreateIndexModel<ProductReview>(
            Builders<ProductReview>.IndexKeys
                .Ascending(r => r.UserId)
                .Ascending(r => r.ProductId)
                .Ascending(r => r.OrderId),
            new CreateIndexOptions { Unique = true, Name = ReviewUniqueIndexName }));

        await BackfillPurchaseDatesAsync(all.Where(r => r.PurchasedAt == null && !extras.Contains(r.Id!)));

        foreach (var productId in all.Select(r => r.ProductId).Distinct())
            await RecomputeRatingAsync(productId);

        return extras.Count;
    }

    /// <summary>The unique (customer, product, order) index - one review per purchase.
    /// MongoDbService drops the per-product indexes earlier builds made.</summary>
    public const string ReviewUniqueIndexName = "review_one_per_purchase";

    /// <summary>Copies each order's date onto the reviews written for it before reviews carried
    /// one. An order that no longer exists leaves the date empty; the card then simply omits it.</summary>
    private async Task BackfillPurchaseDatesAsync(IEnumerable<ProductReview> reviews)
    {
        foreach (var group in reviews.GroupBy(r => r.OrderId))
        {
            if (!ObjectId.TryParse(group.Key, out _)) continue;
            var order = await db.Orders.Find(o => o.Id == group.Key).FirstOrDefaultAsync();
            if (order == null) continue;
            await _reviews.UpdateManyAsync(
                Builders<ProductReview>.Filter.In(r => r.Id, group.Select(r => r.Id!)),
                Builders<ProductReview>.Update.Set(r => r.PurchasedAt, order.CreatedAt));
        }
    }

    private static bool IsDelivered(Order order) =>
        string.Equals(order.Status, "Delivered", StringComparison.OrdinalIgnoreCase);

    /// <summary>Trimmed, capped, and without control characters; line breaks survive (at most one
    /// blank line in a row) because a customer's paragraph is theirs to break.</summary>
    public static string CleanComment(string? comment)
    {
        if (string.IsNullOrWhiteSpace(comment)) return string.Empty;

        var builder = new StringBuilder(comment.Length);
        foreach (var ch in comment.Replace("\r\n", "\n"))
        {
            if (ch == '\n' || !char.IsControl(ch)) builder.Append(ch);
        }

        var text = builder.ToString().Trim();
        while (text.Contains("\n\n\n")) text = text.Replace("\n\n\n", "\n\n");

        return text.Length > ProductReview.CommentMaxLength
            ? text[..ProductReview.CommentMaxLength].TrimEnd()
            : text;
    }
}
