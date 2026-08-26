using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.RateLimiting;
using OjasApi.Filters;
using OjasApi.Models;
using OjasApi.Services;

namespace OjasApi.Controllers;

[ApiController]
[Route("api/campaign-banner")]
[EnableRateLimiting("general")]
public class CampaignBannerController : ControllerBase
{
    private readonly CampaignBannerService _campaignBannerService;

    public CampaignBannerController(CampaignBannerService campaignBannerService)
    {
        _campaignBannerService = campaignBannerService;
    }

    // Banners change when a festival campaign is set up - a few times a month at most - and
    // are fetched on every visit, so this is exactly the response a cache should be answering.
    [HttpGet]
    [PublicCache(maxAgeSeconds: 300, staleWhileRevalidateSeconds: 3600)]
    public async Task<ActionResult<List<CampaignBanner>>> GetBanners()
    {
        var banners = await _campaignBannerService.GetAllAsync();
        return Ok(banners);
    }

    [HttpPost]
    [Authorize(Roles = "admin")]
    public async Task<ActionResult<CampaignBanner>> CreateBanner([FromBody] CampaignBanner request)
    {
        if (request == null)
        {
            return BadRequest();
        }

        var banner = await _campaignBannerService.CreateAsync(request);
        return Ok(banner);
    }

    [HttpPatch("{id}")]
    [Authorize(Roles = "admin")]
    public async Task<ActionResult<CampaignBanner>> UpdateBanner(string id, [FromBody] CampaignBanner request)
    {
        if (request == null)
        {
            return BadRequest();
        }

        var banner = await _campaignBannerService.UpdateAsync(id, request);
        if (banner == null)
        {
            return NotFound();
        }

        return Ok(banner);
    }

    [HttpDelete("{id}")]
    [Authorize(Roles = "admin")]
    public async Task<IActionResult> DeleteBanner(string id)
    {
        var deleted = await _campaignBannerService.DeleteAsync(id);
        if (!deleted)
        {
            return NotFound();
        }

        return NoContent();
    }
}
