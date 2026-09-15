using System.Security.Claims;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.RateLimiting;
using MongoDB.Driver;
using OjasApi.Models;
using OjasApi.Services;

namespace OjasApi.Controllers;

[ApiController]
[Route("api/[controller]")]
[Authorize]
[EnableRateLimiting("general")]
public class UserController : ControllerBase
{
    private readonly IMongoDbService _db;

    public UserController(IMongoDbService db)
    {
        _db = db;
    }

    private string? GetUserId() => User.FindFirstValue(ClaimTypes.NameIdentifier);

    // GET /api/user/profile
    [HttpGet("profile")]
    public async Task<ActionResult<UserProfileResponse>> GetProfile()
    {
        var userId = GetUserId();
        if (userId == null) return Unauthorized();

        var user = await _db.Users.Find(u => u.Id == userId).FirstOrDefaultAsync();
        if (user == null) return NotFound();

        return Ok(ToProfileResponse(user));
    }

    internal static UserProfileResponse ToProfileResponse(User user) => new(
        user.Id!,
        user.FullName,
        user.Email,
        user.Phone,
        user.CreatedAt,
        (user.SavedAddresses ?? [])
            .Select(a => new SavedAddressDto(a.Label, a.FullAddress, a.Latitude, a.Longitude, a.MapLink, a.IsDefault, a.Phone))
            .ToList(),
        user.IsEmailVerified,
        user.IsPhoneVerified);

    // PUT /api/user/profile
    //
    // The name only. This used to save the email and phone as typed, which let a customer put any
    // number on their account - verify one they own at signup, then swap in one they do not. Both
    // are now changed through ContactDetailsController, which stores neither until a code sent to
    // it has come back.
    [HttpPut("profile")]
    public async Task<IActionResult> UpdateProfile([FromBody] UpdateProfileRequest request)
    {
        var userId = GetUserId();
        if (userId == null) return Unauthorized();

        var currentUser = await _db.Users.Find(u => u.Id == userId).FirstOrDefaultAsync();
        if (currentUser == null) return NotFound();

        // A copy of the site loaded before this change still sends all three fields. Its unchanged
        // email and phone are fine; a changed one is refused rather than quietly dropped, so nobody
        // leaves believing their number was updated when it was not.
        var emailChanged = request.Email != null &&
            !string.Equals(request.Email.Trim(), currentUser.Email, StringComparison.OrdinalIgnoreCase);
        var phoneChanged = request.Phone != null && request.Phone.Trim() != currentUser.Phone;
        if (emailChanged || phoneChanged)
        {
            return BadRequest(new
            {
                message = "Changing your email or mobile number needs a verification code. Use Change next to it on your profile.",
                field = emailChanged ? "email" : "phone",
            });
        }

        var result = await _db.Users.UpdateOneAsync(
            u => u.Id == userId,
            Builders<User>.Update.Set(u => u.FullName, request.FullName.Trim()));
        if (result.MatchedCount == 0) return NotFound();
        return NoContent();
    }

    // GET /api/user/addresses
    [HttpGet("addresses")]
    public async Task<ActionResult<List<SavedAddressDto>>> GetAddresses()
    {
        var userId = GetUserId();
        if (userId == null) return Unauthorized();

        var user = await _db.Users.Find(u => u.Id == userId).FirstOrDefaultAsync();
        if (user == null) return NotFound();

        return Ok(user.SavedAddresses.Select(a => new SavedAddressDto(a.Label, a.FullAddress, a.Latitude, a.Longitude, a.MapLink, a.IsDefault, a.Phone)).ToList());
    }

    // POST /api/user/addresses
    [HttpPost("addresses")]
    public async Task<IActionResult> AddAddress([FromBody] SaveAddressRequest request)
    {
        var userId = GetUserId();
        if (userId == null) return Unauthorized();

        if (request.Latitude is null || request.Longitude is null)
            return BadRequest(new { message = "Please pin your exact location on the map." });

        if (request.Latitude == 0 && request.Longitude == 0)
            return BadRequest(new { message = "That pin looks unset. Please drop a pin on the map before saving this address." });

        // Ensure savedAddresses array exists for documents created before this field was added
        await _db.Users.UpdateOneAsync(
            Builders<User>.Filter.And(
                Builders<User>.Filter.Eq(u => u.Id, userId),
                Builders<User>.Filter.Exists(u => u.SavedAddresses, false)
            ),
            Builders<User>.Update.Set(u => u.SavedAddresses, new List<SavedAddress>())
        );

        var newAddress = new SavedAddress
        {
            Label = request.Label,
            Phone = request.Phone,
            FullAddress = request.FullAddress,
            Latitude = request.Latitude.Value,
            Longitude = request.Longitude.Value,
            MapLink = BuildMapLink(request.Latitude.Value, request.Longitude.Value),
            IsDefault = request.IsDefault,
        };

        // If marked default, clear other defaults first
        if (request.IsDefault)
        {
            var clearDefault = Builders<User>.Update.Set("savedAddresses.$[].isDefault", false);
            await _db.Users.UpdateOneAsync(u => u.Id == userId, clearDefault);
        }

        var update = Builders<User>.Update.Push(u => u.SavedAddresses, newAddress);
        await _db.Users.UpdateOneAsync(u => u.Id == userId, update);

        return Ok(new { message = "Address saved." });
    }

    // DELETE /api/user/addresses/{index}
    [HttpDelete("addresses/{index:int}")]
    public async Task<IActionResult> DeleteAddress(int index)
    {
        var userId = GetUserId();
        if (userId == null) return Unauthorized();

        var user = await _db.Users.Find(u => u.Id == userId).FirstOrDefaultAsync();
        if (user == null) return NotFound();

        if (index < 0 || index >= user.SavedAddresses.Count)
            return BadRequest(new { message = "Invalid address index." });

        user.SavedAddresses.RemoveAt(index);

        var update = Builders<User>.Update.Set(u => u.SavedAddresses, user.SavedAddresses);
        await _db.Users.UpdateOneAsync(u => u.Id == userId, update);

        return Ok(new { message = "Address removed." });
    }

    private static bool IsValidHttpUrl(string value)
    {
        return Uri.TryCreate(value, UriKind.Absolute, out var uri)
            && (uri.Scheme == Uri.UriSchemeHttp || uri.Scheme == Uri.UriSchemeHttps);
    }

    internal static string BuildMapLink(double latitude, double longitude)
    {
        return $"https://www.google.com/maps?q={latitude.ToString(System.Globalization.CultureInfo.InvariantCulture)},{longitude.ToString(System.Globalization.CultureInfo.InvariantCulture)}";
    }
}
