using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.RateLimiting;
using OjasApi.Filters;
using OjasApi.Models;
using OjasApi.Services;

namespace OjasApi.Controllers;

[ApiController]
[Route("api/delivery-charges")]
[EnableRateLimiting("general")]
public class DeliveryChargesController : ControllerBase
{
    private readonly DeliveryChargesService _deliveryChargesService;

    public DeliveryChargesController(DeliveryChargesService deliveryChargesService)
    {
        _deliveryChargesService = deliveryChargesService;
    }

    // Fetched at app boot on every visit — DeliveryChargesService loads it in its constructor —
    // so the edge answers it rather than the instance. It is admin-editable all the same: a
    // storefront that has not caught up with a changed charge quotes the customer one delivery fee
    // and bills them another at checkout.
    [HttpGet]
    [AdminEditableCache]
    public async Task<ActionResult<DeliveryCharges>> GetConfig()
    {
        var config = await _deliveryChargesService.GetAsync();
        if (config == null)
        {
            return NotFound();
        }
        return Ok(config);
    }

    [HttpPatch]
    [Authorize(Roles = "admin")]
    public async Task<ActionResult<DeliveryCharges>> UpdateConfig([FromBody] DeliveryCharges request)
    {
        if (request == null)
        {
            return BadRequest();
        }

        var config = await _deliveryChargesService.UpsertAsync(request);
        return Ok(config);
    }

    /// <summary>The estimate shown before an order is placed. Takes the pincode as well as the
    /// pin so the preview matches what the order will actually be charged - the two are computed
    /// by the same method, and once pincodes are configured only the pincode counts.
    ///
    /// A POST with the location in the body, not a GET with it in the address: a URL is written
    /// verbatim into every access log between the browser and here (Vercel's, Render's), and a
    /// customer's exact pin is effectively their home address.</summary>
    [HttpPost("calculate")]
    public Task<ActionResult<DeliveryChargeCalculationResponse>> Calculate([FromBody] DeliveryQuoteRequest request) =>
        QuoteAsync(request.Latitude, request.Longitude, request.Pincode);

    /// <summary>The old shape, kept only so a browser still running the previous build keeps
    /// working through a deploy. Nothing current calls it; remove it once that build is gone.</summary>
    [HttpGet("calculate")]
    public Task<ActionResult<DeliveryChargeCalculationResponse>> CalculateFromQuery(
        [FromQuery] double latitude,
        [FromQuery] double longitude,
        [FromQuery] string? pincode = null) =>
        QuoteAsync(latitude, longitude, pincode);

    private async Task<ActionResult<DeliveryChargeCalculationResponse>> QuoteAsync(double latitude, double longitude, string? pincode)
    {
        var quote = await _deliveryChargesService.CalculateDeliveryChargeAsync(latitude, longitude, pincode);
        return Ok(new DeliveryChargeCalculationResponse(
            quote.DistanceKm,
            quote.Charge,
            quote.IsFree,
            quote.IsServiceable,
            quote.MaxRadiusKm,
            quote.PricedByPincode));
    }
}