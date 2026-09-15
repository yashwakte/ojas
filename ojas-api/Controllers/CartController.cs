using System.Security.Claims;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.RateLimiting;
using OjasApi.Models;
using OjasApi.Services;

namespace OjasApi.Controllers;

/// <summary>
/// The signed-in customer's own cart and checkout selection. There is no way to name another
/// account here: every call reads and writes the cart of whoever the session belongs to.
///
/// Guests have no server cart. Their basket stays in the browser and is merged into this one by
/// the frontend the moment they sign in.
/// </summary>
[ApiController]
[Route("api/[controller]")]
[Authorize]
[EnableRateLimiting("general")]
public class CartController(CartService cartService) : ControllerBase
{
    [HttpGet]
    public async Task<ActionResult<CartResponse>> Get()
    {
        var userId = User.FindFirstValue(ClaimTypes.NameIdentifier);
        if (userId == null) return Unauthorized();

        return Ok(await cartService.GetAsync(userId));
    }

    [HttpPut("items")]
    public Task<IActionResult> ReplaceItems([FromBody] ReplaceCartLinesRequest request) =>
        Replace(CartList.Cart, request);

    [HttpPut("checkout")]
    public Task<IActionResult> ReplaceCheckout([FromBody] ReplaceCartLinesRequest request) =>
        Replace(CartList.Checkout, request);

    /// <summary>Answers 204 rather than echoing the cart back. The client already holds what it
    /// just sent, and a response applied on arrival could overwrite an edit the customer made
    /// while this request was in flight.</summary>
    private async Task<IActionResult> Replace(CartList list, ReplaceCartLinesRequest request)
    {
        var userId = User.FindFirstValue(ClaimTypes.NameIdentifier);
        if (userId == null) return Unauthorized();

        if (request?.Items == null)
            return BadRequest(new { message = "Send the items to save." });

        if (request.Items.Count > CartService.MaxLines)
            return BadRequest(new { message = $"A cart can hold at most {CartService.MaxLines} different items." });

        await cartService.ReplaceAsync(userId, list, request.Items);
        return NoContent();
    }
}
