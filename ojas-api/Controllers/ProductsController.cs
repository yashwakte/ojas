using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.RateLimiting;
using OjasApi.Models;
using OjasApi.Services;

namespace OjasApi.Controllers;

[ApiController]
[Route("api/[controller]")]
[EnableRateLimiting("general")]
public class ProductsController : ControllerBase
{
    private readonly ProductService _productService;

    public ProductsController(ProductService productService)
    {
        _productService = productService;
    }

    [HttpGet]
    public async Task<ActionResult<List<Product>>> GetAll()
    {
        var products = await _productService.GetAllAsync();
        return Ok(products);
    }

    [HttpGet("{id}")]
    public async Task<ActionResult<Product>> GetById(string id)
    {
        var product = await _productService.GetByIdAsync(id);
        if (product == null) return NotFound();
        return Ok(product);
    }

    [HttpGet("category/{category}")]
    public async Task<ActionResult<List<Product>>> GetByCategory(string category)
    {
        var products = await _productService.GetByCategoryAsync(category);
        return Ok(products);
    }

    [HttpGet("bestsellers")]
    public async Task<ActionResult<List<Product>>> GetBestsellers([FromQuery] int limit = 6)
    {
        var clampedLimit = Math.Clamp(limit, 1, 24);
        var products = await _productService.GetBestsellersAsync(clampedLimit);
        return Ok(products);
    }

    /// <summary>Tracked products at or below their low-stock threshold.</summary>
    [HttpGet("low-stock")]
    [Authorize(Roles = UserRoles.Admin)]
    public async Task<ActionResult<List<Product>>> GetLowStock()
    {
        return Ok(await _productService.GetLowStockAsync());
    }

    [HttpPost]
    [Authorize(Roles = UserRoles.Admin)]
    public async Task<ActionResult<Product>> Create([FromBody] CreateProductRequest request)
    {
        var product = new Product
        {
            Name = Clean(request.Name),
            Description = Clean(request.Description),
            Price = request.Price,
            Discount = request.Discount,
            Category = Clean(request.Category),
            ImageUrl = request.ImageUrl.Trim(),
            GalleryImageUrls = CleanGallery(request.GalleryImageUrls),
            Weight = Clean(request.Weight),
            IsAvailable = request.IsAvailable,
            StockQuantity = request.StockQuantity,
            LowStockThreshold = request.LowStockThreshold ?? 5,
            Ingredients = Clean(request.Ingredients),
            Benefits = Clean(request.Benefits),
            StorageInfo = Clean(request.StorageInfo),
        };

        if (!IsValid(product, out var error))
            return BadRequest(new { message = error });

        var created = await _productService.CreateAsync(product);
        return CreatedAtAction(nameof(GetById), new { id = created.Id }, created);
    }

    [HttpPatch("{id}")]
    [Authorize(Roles = UserRoles.Admin)]
    public async Task<ActionResult<Product>> Update(string id, [FromBody] UpdateProductRequest request)
    {
        if (!HasUpdates(request))
            return BadRequest(new { message = "Provide at least one product field to update." });

        var normalizedRequest = new UpdateProductRequest
        {
            Name = request.Name is null ? null : Clean(request.Name),
            Description = request.Description is null ? null : Clean(request.Description),
            Price = request.Price,
            Discount = request.Discount,
            Category = request.Category is null ? null : Clean(request.Category),
            ImageUrl = request.ImageUrl?.Trim(),
            GalleryImageUrls = request.GalleryImageUrls is null ? null : CleanGallery(request.GalleryImageUrls),
            Weight = request.Weight is null ? null : Clean(request.Weight),
            IsAvailable = request.IsAvailable,
            StockQuantity = request.StockQuantity,
            LowStockThreshold = request.LowStockThreshold,
            Ingredients = request.Ingredients is null ? null : Clean(request.Ingredients),
            Benefits = request.Benefits is null ? null : Clean(request.Benefits),
            StorageInfo = request.StorageInfo is null ? null : Clean(request.StorageInfo),
        };

        var current = await _productService.GetByIdAsync(id);
        if (current == null)
            return NotFound(new { message = "Product not found." });

        Apply(current, normalizedRequest);
        if (!IsValid(current, out var error))
            return BadRequest(new { message = error });

        var updated = await _productService.UpdateAsync(id, normalizedRequest);

        return Ok(updated!);
    }

    [HttpDelete("{id}")]
    [Authorize(Roles = UserRoles.Admin)]
    public async Task<IActionResult> Delete(string id)
    {
        var deleted = await _productService.DeleteAsync(id);
        if (!deleted)
            return NotFound(new { message = "Product not found." });

        return NoContent();
    }

    private static bool HasUpdates(UpdateProductRequest request) =>
        request.Name != null || request.Description != null || request.Price.HasValue ||
        request.Discount.HasValue || request.Category != null || request.ImageUrl != null ||
        request.GalleryImageUrls != null || request.Weight != null || request.IsAvailable.HasValue ||
        request.StockQuantity.HasValue || request.LowStockThreshold.HasValue ||
        request.Ingredients != null || request.Benefits != null || request.StorageInfo != null;

    private static string Clean(string value) => value.Trim().Replace("<", string.Empty).Replace(">", string.Empty);

    private static List<string> CleanGallery(List<string>? urls) =>
        (urls ?? []).Where(u => !string.IsNullOrWhiteSpace(u)).Select(u => u.Trim()).Take(5).ToList();

    private static void Apply(Product product, UpdateProductRequest request)
    {
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
    }

    private static bool IsValid(Product product, out string error)
    {
        if (string.IsNullOrWhiteSpace(product.Name) || string.IsNullOrWhiteSpace(product.Description) ||
            string.IsNullOrWhiteSpace(product.Category) || string.IsNullOrWhiteSpace(product.ImageUrl) ||
            string.IsNullOrWhiteSpace(product.Weight) || string.IsNullOrWhiteSpace(product.Ingredients) ||
            string.IsNullOrWhiteSpace(product.Benefits) || string.IsNullOrWhiteSpace(product.StorageInfo))
        {
            error = "All product fields are required.";
            return false;
        }

        if (product.Price <= 0 || product.Price > 100000 || product.Discount is < 0 or > 100)
        {
            error = "Price or discount is outside the allowed range.";
            return false;
        }

        error = string.Empty;
        return true;
    }
}
