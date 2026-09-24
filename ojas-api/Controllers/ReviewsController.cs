using System.Security.Claims;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.RateLimiting;
using OjasApi.Filters;
using OjasApi.Models;
using OjasApi.Services;

namespace OjasApi.Controllers;

/// <summary>
/// Product reviews. Reading them is public and cached like the catalogue; writing one needs a
/// signed-in customer with the product on a delivered order; taking one down is the admin's.
/// </summary>
[ApiController]
[Route("api/[controller]")]
[Authorize]
[EnableRateLimiting("general")]
public class ReviewsController(
    ReviewService reviewService,
    ProductService productService,
    ILogger<ReviewsController> logger) : ControllerBase
{
    private string? CurrentUserId => User.FindFirstValue(ClaimTypes.NameIdentifier);

    /// <summary>A product's summary, its top reviews (first page only) and one page of reviews,
    /// newest first. Takes the slug or the id, like the product page's own address; <c>skip</c>
    /// and <c>take</c> page through the rest ("Show more").</summary>
    [HttpGet("product/{key}")]
    [AllowAnonymous]
    [AdminEditableCache]
    public async Task<ActionResult<ProductReviewsResponse>> GetForProduct(
        string key,
        [FromQuery] int skip = 0,
        [FromQuery] int take = ReviewService.ProductPageSize)
    {
        var product = await productService.GetByIdOrSlugAsync(key, includeUnlisted: false);
        if (product == null)
            return NotFound(new { message = "Product not found." });

        var (summary, top, reviews) = await reviewService.GetForProductAsync(product.Id!, skip, take);
        return Ok(new ProductReviewsResponse(
            summary.ToResponse(),
            reviews.Select(r => r.ToResponse()).ToList(),
            top.Select(r => r.ToResponse()).ToList()));
    }

    /// <summary>The home page's review wall.</summary>
    [HttpGet("featured")]
    [AllowAnonymous]
    [AdminEditableCache]
    public async Task<ActionResult<List<ReviewResponse>>> GetFeatured()
    {
        var reviews = await reviewService.GetFeaturedAsync();
        return Ok(reviews.Select(r => r.ToResponse()).ToList());
    }

    /// <summary>This customer's reviews and what they may still review.</summary>
    [HttpGet("my")]
    public async Task<ActionResult<MyReviewsResponse>> GetMine()
    {
        var userId = CurrentUserId;
        if (userId == null) return Unauthorized();

        var reviews = await reviewService.GetMineAsync(userId);
        var reviewable = await reviewService.GetReviewableProductIdsAsync(userId);
        return Ok(new MyReviewsResponse(reviews.Select(r => r.ToOwnResponse()).ToList(), reviewable));
    }

    /// <summary>Posts the review for one purchase of a product. <paramref name="orderId"/> names
    /// the delivered order it is for; without it, the earliest unreviewed one is used.</summary>
    [HttpPost("my/{productId}")]
    public async Task<ActionResult<ReviewResponse>> Create(
        string productId, [FromBody] WriteReviewRequest request, [FromQuery] string? orderId = null)
    {
        var userId = CurrentUserId;
        if (userId == null) return Unauthorized();

        var outcome = await reviewService.CreateAsync(userId, productId, request.Rating, request.Comment, orderId);
        if (outcome.Review == null)
            return BadRequest(new { message = outcome.Error ?? "This review could not be saved." });

        logger.LogInformation(
            "Customer {UserId} reviewed product {ProductId} with {Rating} stars.",
            userId, productId, request.Rating);

        return Ok(outcome.Review.ToOwnResponse());
    }

    /// <summary>Rewrites one of this customer's own reviews.</summary>
    [HttpPut("my/review/{reviewId}")]
    public async Task<ActionResult<ReviewResponse>> Update(string reviewId, [FromBody] WriteReviewRequest request)
    {
        var userId = CurrentUserId;
        if (userId == null) return Unauthorized();

        var outcome = await reviewService.UpdateMineAsync(userId, reviewId, request.Rating, request.Comment);
        return outcome.Review == null
            ? NotFound(new { message = outcome.Error ?? "Review not found." })
            : Ok(outcome.Review.ToOwnResponse());
    }

    [HttpDelete("my/review/{reviewId}")]
    public async Task<IActionResult> DeleteMine(string reviewId)
    {
        var userId = CurrentUserId;
        if (userId == null) return Unauthorized();

        return await reviewService.DeleteMineAsync(userId, reviewId)
            ? NoContent()
            : NotFound(new { message = "Review not found." });
    }

    // ===== ADMIN =====

    [HttpGet("admin/all")]
    [Authorize(Roles = UserRoles.Admin)]
    public async Task<ActionResult<List<ReviewResponse>>> GetAllForAdmin()
    {
        var reviews = await reviewService.GetAllForAdminAsync();
        return Ok(reviews.Select(r => r.ToAdminResponse()).ToList());
    }

    /// <summary>Hides a review from the storefront, or puts it back. The words and stars are the
    /// customer's and are never edited from here.</summary>
    [HttpPatch("admin/{id}/visibility")]
    [Authorize(Roles = UserRoles.Admin)]
    public async Task<ActionResult<ReviewResponse>> SetVisibility(string id, [FromBody] SetReviewVisibilityRequest request)
    {
        var review = await reviewService.SetHiddenAsync(id, request.Hidden);
        if (review == null)
            return NotFound(new { message = "Review not found." });

        logger.LogInformation(
            "Admin {AdminId} {Action} review {ReviewId}.",
            CurrentUserId, request.Hidden ? "hid" : "restored", id);

        return Ok(review.ToAdminResponse());
    }
}
