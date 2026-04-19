using System.Security.Claims;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using MongoDB.Driver;
using OjasApi.Models;
using OjasApi.Services;

namespace OjasApi.Controllers;

[ApiController]
[Route("api/[controller]")]
[Authorize]
public class UserController : ControllerBase
{
    private readonly MongoDbService _db;

    public UserController(MongoDbService db)
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

        var addresses = (user.SavedAddresses ?? []).Select(a => new SavedAddressDto(a.Label, a.FullAddress, a.IsDefault)).ToList();
        return Ok(new UserProfileResponse(user.Id!, user.FullName, user.Email, user.Phone, user.CreatedAt, addresses));
    }

    // PUT /api/user/profile
    [HttpPut("profile")]
    public async Task<IActionResult> UpdateProfile([FromBody] UpdateProfileRequest request)
    {
        var userId = GetUserId();
        if (userId == null) return Unauthorized();

        var update = Builders<User>.Update
            .Set(u => u.FullName, request.FullName)
            .Set(u => u.Phone, request.Phone);

        try
        {
            var result = await _db.Users.UpdateOneAsync(u => u.Id == userId, update);
            if (result.MatchedCount == 0) return NotFound();
            return NoContent();
        }
        catch (MongoWriteException ex) when (ex.WriteError.Code == 11000)
        {
            return Conflict(new { message = "This phone number is already associated with another account." });
        }
    }

    // GET /api/user/addresses
    [HttpGet("addresses")]
    public async Task<ActionResult<List<SavedAddressDto>>> GetAddresses()
    {
        var userId = GetUserId();
        if (userId == null) return Unauthorized();

        var user = await _db.Users.Find(u => u.Id == userId).FirstOrDefaultAsync();
        if (user == null) return NotFound();

        return Ok(user.SavedAddresses.Select(a => new SavedAddressDto(a.Label, a.FullAddress, a.IsDefault)).ToList());
    }

    // POST /api/user/addresses
    [HttpPost("addresses")]
    public async Task<IActionResult> AddAddress([FromBody] SaveAddressRequest request)
    {
        var userId = GetUserId();
        if (userId == null) return Unauthorized();

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
            FullAddress = request.FullAddress,
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
}
