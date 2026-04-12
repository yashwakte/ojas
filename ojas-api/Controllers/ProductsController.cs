using Microsoft.AspNetCore.Mvc;
using OjasApi.Models;
using OjasApi.Services;

namespace OjasApi.Controllers;

[ApiController]
[Route("api/[controller]")]
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
}
