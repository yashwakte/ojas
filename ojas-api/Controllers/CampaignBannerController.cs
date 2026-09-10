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

    // Admin-published content: when the owner saves a banner they check the storefront straight
    // away, and so do the customers who were told about the sale. So the browser never keeps its
    // own copy - it asks the edge every time, which answers in milliseconds - and the edge holds
    // it for 15 seconds plus 45 of background refresh. A new banner is live for everyone within a
    // minute of Save, and the API still sees a handful of requests a minute however many people
    // are browsing. It used to be five minutes in the browser and up to an hour at the edge,
    // which is how a published banner stayed invisible in a normal tab while incognito showed it.
    [HttpGet]
    [AdminEditableCache]
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
