using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.RateLimiting;
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

    [HttpGet]
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

    [HttpGet("calculate")]
    public async Task<ActionResult<DeliveryChargeCalculationResponse>> Calculate([FromQuery] double latitude, [FromQuery] double longitude)
    {
        var quote = await _deliveryChargesService.CalculateDeliveryChargeAsync(latitude, longitude);
        return Ok(new DeliveryChargeCalculationResponse(
            quote.DistanceKm,
            quote.Charge,
            quote.IsFree,
            quote.IsServiceable,
            quote.MaxRadiusKm));
    }
}