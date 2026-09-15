using System.Security.Claims;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.RateLimiting;
using MongoDB.Driver;
using OjasApi.Models;
using OjasApi.Services;

namespace OjasApi.Controllers;

/// <summary>
/// Changing the email or mobile number on an account, and confirming the email a customer signed
/// up with.
///
/// Both details used to be plain fields on the profile form, saved exactly as typed. A customer
/// could put any number at all on their account - someone else's, or one that does not exist -
/// and every delivery call, order update and receipt after that went to it. A detail is now only
/// stored once a code sent to it has come back: that is the proof that the new address or number
/// really belongs to the person making the change.
///
/// No password is asked for on top of the code - the owner's call (September 2026), since the
/// customer is already signed in and the code is what matters for the shop. The trade-off is
/// known: someone holding an unlocked, signed-in phone could move the account's email to their
/// own. The rate limit below still caps how many codes one account can request.
/// </summary>
[ApiController]
[Route("api/user")]
[Authorize]
[EnableRateLimiting("contact-change")]
public class ContactDetailsController : ControllerBase
{
    /// <summary>Long enough to wait for a text and type it in; short enough that a number checked
    /// and then abandoned is not left waiting on this account.</summary>
    internal static readonly TimeSpan PendingPhoneLifetime = TimeSpan.FromMinutes(15);

    private readonly IMongoDbService _db;
    private readonly OtpService _otpService;
    private readonly Msg91WidgetVerifier _phoneWidgetVerifier;
    private readonly IWebHostEnvironment _env;
    private readonly ILogger<ContactDetailsController> _logger;

    public ContactDetailsController(
        IMongoDbService db,
        OtpService otpService,
        Msg91WidgetVerifier phoneWidgetVerifier,
        IWebHostEnvironment env,
        ILogger<ContactDetailsController> logger)
    {
        _db = db;
        _otpService = otpService;
        _phoneWidgetVerifier = phoneWidgetVerifier;
        _env = env;
        _logger = logger;
    }

    private string? GetUserId() => User.FindFirstValue(ClaimTypes.NameIdentifier);

    private async Task<User?> LoadUserAsync(string userId) =>
        await _db.Users.Find(u => u.Id == userId).FirstOrDefaultAsync();

    private Task<bool> EmailTakenAsync(string email, string userId) =>
        _db.Users.Find(u => u.Email == email && u.Id != userId).AnyAsync();

    private Task<bool> PhoneTakenAsync(string phone, string userId) =>
        _db.Users.Find(u => u.Phone == phone && u.Id != userId).AnyAsync();

    private static ConflictObjectResult EmailInUse() =>
        new(new { message = "This email is already registered to another account.", field = "email" });

    private static ConflictObjectResult PhoneInUse() =>
        new(new { message = "This number is already linked to another account.", field = "phone" });

    // POST /api/user/email/send-code
    [HttpPost("email/send-code")]
    public async Task<ActionResult<ContactCodeSentResponse>> SendEmailCode([FromBody] SendEmailCodeRequest request)
    {
        var userId = GetUserId();
        if (userId == null) return Unauthorized();

        var user = await LoadUserAsync(userId);
        if (user == null) return NotFound();

        var email = AuthService.NormalizeEmail(request.Email);
        var isCurrent = email == AuthService.NormalizeEmail(user.Email);

        if (isCurrent && user.IsEmailVerified)
            return BadRequest(new { message = "This email is already verified.", field = "email" });

        if (!isCurrent && await EmailTakenAsync(email, userId))
            return EmailInUse();

        var channel = isCurrent ? OtpChannels.EmailConfirm : OtpChannels.EmailChange;
        var code = await _otpService.SendContactEmailOtpAsync(userId, email, channel);

        return Ok(new ContactCodeSentResponse(
            $"We've sent a 6-digit code to {email}.",
            _env.IsDevelopment() ? code : null));
    }

    // POST /api/user/email/verify
    [HttpPost("email/verify")]
    public async Task<ActionResult<UserProfileResponse>> VerifyEmail([FromBody] VerifyEmailCodeRequest request)
    {
        var userId = GetUserId();
        if (userId == null) return Unauthorized();

        var user = await LoadUserAsync(userId);
        if (user == null) return NotFound();

        var email = AuthService.NormalizeEmail(request.Email);
        var isCurrent = email == AuthService.NormalizeEmail(user.Email);

        // The channel follows what the address is to the account *now*, so a code sent to confirm
        // the old address cannot later be spent as a change back to it, or the other way round.
        var channel = isCurrent ? OtpChannels.EmailConfirm : OtpChannels.EmailChange;
        if (!await _otpService.VerifyAsync(OtpService.ContactEmailTarget(userId, email), channel, request.Code))
            return BadRequest(new { message = "That code is invalid or has expired.", field = "code" });

        // Checked again rather than trusted from the send step: another account can have claimed
        // the address in the ten minutes the code was alive.
        if (!isCurrent && await EmailTakenAsync(email, userId))
            return EmailInUse();

        var update = Builders<User>.Update.Set(u => u.IsEmailVerified, true);
        if (!isCurrent)
            update = update.Set(u => u.Email, email);

        try
        {
            await _db.Users.UpdateOneAsync(u => u.Id == userId, update);
        }
        catch (MongoWriteException ex) when (ex.WriteError.Code == 11000)
        {
            return EmailInUse();
        }

        if (!isCurrent)
            _logger.LogInformation("Account {UserId} moved to a new email after verifying it.", userId);

        var updated = await LoadUserAsync(userId);
        return updated == null ? NotFound() : Ok(UserController.ToProfileResponse(updated));
    }

    /// <summary>Step one of a number change. The text code is sent by MSG91's widget from the
    /// browser, not from here, so this records which number the account is about to prove - the
    /// only number step two will accept a token for.</summary>
    // POST /api/user/phone/start
    [HttpPost("phone/start")]
    public async Task<IActionResult> StartPhoneChange([FromBody] StartPhoneChangeRequest request)
    {
        var userId = GetUserId();
        if (userId == null) return Unauthorized();

        var user = await LoadUserAsync(userId);
        if (user == null) return NotFound();

        var phone = request.Phone.Trim();
        if (phone == user.Phone)
            return BadRequest(new { message = "That's already the number on your account.", field = "phone" });

        if (!_phoneWidgetVerifier.IsConfigured)
            return StatusCode(StatusCodes.Status503ServiceUnavailable,
                new { message = "Changing your number isn't available right now. Please try again later." });

        if (await PhoneTakenAsync(phone, userId))
            return PhoneInUse();

        await _db.Users.UpdateOneAsync(
            u => u.Id == userId,
            Builders<User>.Update
                .Set(u => u.PendingPhone, phone)
                .Set(u => u.PendingPhoneExpiresAt, DateTime.UtcNow.Add(PendingPhoneLifetime)));

        return Ok(new { message = $"Now enter the code we text to {phone}." });
    }

    /// <summary>Step two: a widget token MSG91 verified for exactly the number step one recorded.
    /// The token is checked against MSG91's servers and bound to this number by
    /// Msg91WidgetVerifier, never trusted on the browser's word.</summary>
    // POST /api/user/phone/verify
    [HttpPost("phone/verify")]
    public async Task<ActionResult<UserProfileResponse>> VerifyPhoneChange([FromBody] VerifyPhoneChangeRequest request)
    {
        var userId = GetUserId();
        if (userId == null) return Unauthorized();

        var user = await LoadUserAsync(userId);
        if (user == null) return NotFound();

        var phone = request.Phone.Trim();
        if (user.PendingPhone != phone || user.PendingPhoneExpiresAt is not { } expiresAt || expiresAt < DateTime.UtcNow)
            return BadRequest(new { message = "This number change has expired. Please start it again.", field = "phone" });

        var verification = await _phoneWidgetVerifier.VerifyAsync(request.WidgetToken, phone);
        if (!verification.Success)
        {
            _logger.LogWarning(
                "Number change for {UserId} rejected at the MSG91 verification step: {Error}",
                userId, verification.Error);
            return BadRequest(new { message = verification.Error ?? "That code is invalid or has expired.", field = "code" });
        }

        if (await PhoneTakenAsync(phone, userId))
            return PhoneInUse();

        // The pending number is part of the filter, so of two overlapping attempts only the one
        // that step one last recorded can land.
        var filter = Builders<User>.Filter.And(
            Builders<User>.Filter.Eq(u => u.Id, userId),
            Builders<User>.Filter.Eq(u => u.PendingPhone, phone));
        var update = Builders<User>.Update
            .Set(u => u.Phone, phone)
            .Set(u => u.IsPhoneVerified, true)
            .Set(u => u.PendingPhone, (string?)null)
            .Set(u => u.PendingPhoneExpiresAt, (DateTime?)null);

        try
        {
            var result = await _db.Users.UpdateOneAsync(filter, update);
            if (result.MatchedCount == 0)
                return BadRequest(new { message = "This number change has expired. Please start it again.", field = "phone" });
        }
        catch (MongoWriteException ex) when (ex.WriteError.Code == 11000)
        {
            return PhoneInUse();
        }

        _logger.LogInformation("Account {UserId} moved to a new number after verifying it.", userId);

        var updated = await LoadUserAsync(userId);
        return updated == null ? NotFound() : Ok(UserController.ToProfileResponse(updated));
    }
}
