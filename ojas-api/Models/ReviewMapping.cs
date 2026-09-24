using OjasApi.Services;

namespace OjasApi.Models;

/// <summary>
/// Turns stored reviews into what the API hands back. The public shape leaves out which order a
/// review came from and whether it is hidden; filling those is an explicit act, the same split
/// <see cref="ReturnMapping"/> makes between a customer's and an admin's view.
/// </summary>
public static class ReviewMapping
{
    public static ReviewResponse ToResponse(this ProductReview review) =>
        new(
            review.Id!,
            review.ProductId,
            review.ProductName,
            review.AuthorName,
            review.Rating,
            review.Comment,
            review.CreatedAt,
            review.UpdatedAt)
        {
            PurchasedAt = review.PurchasedAt,
        };

    /// <summary>The author's own view: tells them if an admin has taken it down.</summary>
    public static ReviewResponse ToOwnResponse(this ProductReview review) =>
        review.ToResponse() with { IsHidden = review.IsHidden, OrderId = review.OrderId };

    public static ReviewResponse ToAdminResponse(this ProductReview review) =>
        review.ToResponse() with { IsHidden = review.IsHidden, OrderId = review.OrderId };

    public static ReviewSummaryResponse ToResponse(this ProductReviewSummary summary) =>
        new(summary.Average, summary.Count, summary.Distribution);
}
