using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.RateLimiting;
using OjasApi.Filters;
using OjasApi.Models;
using OjasApi.Services;

namespace OjasApi.Controllers;

[ApiController]
[Route("api/hero-slides")]
[EnableRateLimiting("general")]
public class HeroSlideController : ControllerBase
{
    private readonly HeroSlideService _heroSlideService;

    public HeroSlideController(HeroSlideService heroSlideService)
    {
        _heroSlideService = heroSlideService;
    }

    // The first request of the first screenful of the site, and it changes a few times a month
    // at most. Same cache treatment as the campaign banners for the same reason.
    [HttpGet]
    [AdminEditableCache]
    public async Task<ActionResult<List<HeroSlide>>> GetSlides()
    {
        var slides = await _heroSlideService.GetAllAsync();
        return Ok(slides);
    }

    [HttpPost]
    [Authorize(Roles = "admin")]
    public async Task<ActionResult<HeroSlide>> CreateSlide([FromBody] HeroSlide request)
    {
        if (request == null || string.IsNullOrWhiteSpace(request.ImageUrl))
        {
            return BadRequest(new { message = "A hero slide needs an image." });
        }

        var slide = await _heroSlideService.CreateAsync(request);
        return Ok(slide);
    }

    [HttpPatch("{id}")]
    [Authorize(Roles = "admin")]
    public async Task<ActionResult<HeroSlide>> UpdateSlide(string id, [FromBody] HeroSlide request)
    {
        if (request == null || string.IsNullOrWhiteSpace(request.ImageUrl))
        {
            return BadRequest(new { message = "A hero slide needs an image." });
        }

        var slide = await _heroSlideService.UpdateAsync(id, request);
        if (slide == null)
        {
            return NotFound();
        }

        return Ok(slide);
    }

    [HttpDelete("{id}")]
    [Authorize(Roles = "admin")]
    public async Task<IActionResult> DeleteSlide(string id)
    {
        var deleted = await _heroSlideService.DeleteAsync(id);
        if (!deleted)
        {
            return NotFound();
        }

        return NoContent();
    }
}
