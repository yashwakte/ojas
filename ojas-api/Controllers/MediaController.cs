using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.RateLimiting;
using Microsoft.Net.Http.Headers;
using OjasApi.Services;

namespace OjasApi.Controllers;

[ApiController]
[Route("api/media")]
public class MediaController : ControllerBase
{
    /// <summary>One year, the longest value HTTP caches are obliged to honour.</summary>
    private const int OneYearSeconds = 31_536_000;

    private readonly MediaService _media;

    public MediaController(MediaService media)
    {
        _media = media;
    }

    /// <summary>
    /// Serves one stored image.
    ///
    /// The caching contract here is the whole reason this endpoint exists. Because the URL is
    /// the hash of the bytes, the response can never go stale, so it is marked
    /// <c>public, max-age=1y, immutable</c>: browsers reuse it without even asking, and every
    /// cache in between - Vercel's edge, Render's Cloudflare, a corporate proxy - is free to
    /// answer on our behalf. A returning customer's second page view costs the origin nothing,
    /// and a million of them cost it nothing each.
    ///
    /// <para><c>immutable</c> is deliberately paired with a strong ETag rather than trusted
    /// alone: caches that ignore the hint, and users who force-reload, still get a cheap 304
    /// instead of re-downloading the picture.</para>
    ///
    /// <para>The extension in <paramref name="key"/> is cosmetic for us but not for everyone
    /// else - several CDNs decide what is cacheable by looking at the file extension before they
    /// look at the headers, so the URL ends in .webp rather than in a bare hash.</para>
    /// </summary>
    [HttpGet("{key}")]
    [AllowAnonymous]
    // Deliberately outside the "general" limiter that fronts the rest of the API. Loading one
    // storefront page fetches many images at once, and a browser that gets 429ed on pictures
    // shows a page full of holes. The work per request is a memory-cache hit, and the responses
    // are cacheable precisely so that repeat traffic never reaches this code at all.
    [DisableRateLimiting]
    public async Task<IActionResult> Get(string key, CancellationToken ct)
    {
        var hash = key.Contains('.') ? key[..key.IndexOf('.')] : key;
        if (hash.Length != 64 || !hash.All(char.IsAsciiHexDigitLower)) return NotFound();

        var asset = await _media.GetByHashAsync(hash, ct);
        if (asset == null) return NotFound();

        var etag = new EntityTagHeaderValue($"\"{asset.Hash}\"");

        Response.Headers.CacheControl = $"public, max-age={OneYearSeconds}, immutable";
        Response.Headers.ETag = etag.ToString();
        // The bytes are identical for everyone, but say so explicitly: without it a shared cache
        // could key an image on whichever request headers happened to differ.
        Response.Headers.Vary = "Accept-Encoding";

        var ifNoneMatch = Request.Headers.IfNoneMatch;
        if (ifNoneMatch.Count > 0 && ifNoneMatch.Any(v => v == etag.ToString() || v == "*"))
            return StatusCode(StatusCodes.Status304NotModified);

        return File(asset.Data, asset.ContentType);
    }

    /// <summary>
    /// Stores an image and returns the URL to reference it by.
    ///
    /// The picture is expected to arrive already resized and re-encoded - the admin screens do
    /// that in the browser before uploading (see media-upload.service.ts). Keeping the transcode
    /// on the client rather than the server is intentional: image encoding is by far the most
    /// expensive thing this application could be asked to do, and the API runs on a small shared
    /// instance whose job is to answer orders quickly.
    /// </summary>
    [HttpPost]
    [Authorize(Roles = "admin")]
    [EnableRateLimiting("general")]
    [RequestSizeLimit(MediaService.MaxBytes + 4096)]
    public async Task<IActionResult> Upload(IFormFile? file, CancellationToken ct)
    {
        if (file == null || file.Length == 0)
            return BadRequest(new { message = "No image was uploaded." });

        if (file.Length > MediaService.MaxBytes)
            return BadRequest(new { message = $"Image must be smaller than {MediaService.MaxBytes / (1024 * 1024)}MB." });

        using var buffer = new MemoryStream();
        await file.CopyToAsync(buffer, ct);

        var result = await _media.StoreAsync(buffer.ToArray(), ct);
        if (!result.Succeeded)
        {
            return BadRequest(new
            {
                message = result.Rejection switch
                {
                    MediaRejection.Empty => "The uploaded file was empty.",
                    MediaRejection.TooLarge => $"Image must be smaller than {MediaService.MaxBytes / (1024 * 1024)}MB.",
                    MediaRejection.DimensionsTooLarge => $"Image must be no larger than {MediaService.MaxDimension}px on either side.",
                    _ => "That file is not a PNG, JPEG or WebP image.",
                },
            });
        }

        return Ok(new { url = result.Url, width = result.Width, height = result.Height });
    }
}
