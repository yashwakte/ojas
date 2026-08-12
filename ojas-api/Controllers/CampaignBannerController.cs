using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using OjasApi.Models;
using OjasApi.Services;

namespace OjasApi.Controllers;

[ApiController]
[Route("api/campaign-banner")]
public class CampaignBannerController : ControllerBase
{
    private readonly CampaignBannerService _campaignBannerService;

    public CampaignBannerController(CampaignBannerService campaignBannerService)
    {
        _campaignBannerService = campaignBannerService;
    }

    [HttpGet]
    public async Task<ActionResult<CampaignBanner>> GetBanner()
    {
        var banner = await _campaignBannerService.GetAsync();
        if (banner == null)
        {
            return NotFound();
        }
        return Ok(banner);
    }

    [HttpPatch]
    [Authorize(Roles = "admin")]
    public async Task<ActionResult<CampaignBanner>> UpdateBanner([FromBody] CampaignBanner request)
    {
        if (request == null)
        {
            return BadRequest();
        }

        var banner = await _campaignBannerService.UpsertAsync(request);
        return Ok(banner);
    }
}
