using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using OjasApi.Models;
using OjasApi.Services;

namespace OjasApi.Controllers;

[ApiController]
[Route("api/delivery-charges")]
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
        var (distanceKm, charge, isFree) = await _deliveryChargesService.CalculateDeliveryChargeAsync(latitude, longitude);
        return Ok(new DeliveryChargeCalculationResponse(distanceKm, charge, isFree));
    }
}