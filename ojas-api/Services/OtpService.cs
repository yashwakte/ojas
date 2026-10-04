using MongoDB.Driver;
using OjasApi.Models;

namespace OjasApi.Services;

public class OtpService
{
    private static readonly TimeSpan CodeLifetime = TimeSpan.FromMinutes(10);
    private const int MaxAttempts = 5;

    private readonly IMongoDbService _db;
    private readonly IEmailSender _emailSender;
    private readonly ILogger<OtpService> _logger;

    public OtpService(IMongoDbService db, IEmailSender emailSender, ILogger<OtpService> logger)
    {
        _db = db;
        _emailSender = emailSender;
        _logger = logger;
    }

    /// <summary>
    /// Generates and stores a code, then best-effort emails it. Always returns the plaintext
    /// code (never persisted in plaintext - only its bcrypt hash is stored) so the caller can
    /// surface it as a dev-mode convenience when the real send fails or isn't configured yet;
    /// callers are responsible for only doing that outside Production.
    /// </summary>
    public async Task<string> SendEmailOtpAsync(string email)
    {
        var code = GenerateCode();
        await StoreCodeAsync(email, OtpChannels.Email, code);

        try
        {
            var html = $"""
                <p>Your Ojas verification code is:</p>
                <p style="font-size:28px;font-weight:700;letter-spacing:6px;">{code}</p>
                <p>This code expires in 10 minutes. If you didn't request this, you can ignore this email.</p>
                """;
            await _emailSender.SendAsync(email, "Your Ojas verification code", html);
        }
        catch (Exception ex)
        {
            _logger.LogWarning(ex, "Could not send email OTP to {Email}; the code was still generated.", email);
        }

        return code;
    }

    /// <summary>Same mechanism as the email OTP but on its own channel, and with wording that
    /// makes clear what is being approved - a staff member who gets this without asking should
    /// understand immediately that someone has their password.</summary>
    public async Task<string> SendDeviceOtpAsync(string email)
    {
        var code = GenerateCode();
        await StoreCodeAsync(email, OtpChannels.Device, code);

        try
        {
            var html = $"""
                <p>Someone is trying to sign in to your Ojas staff account from a new device.</p>
                <p>If this was you, use this code to approve that device:</p>
                <p style="font-size:28px;font-weight:700;letter-spacing:6px;">{code}</p>
                <p>This code expires in 10 minutes, and approving a new device signs you out everywhere else.</p>
                <p><strong>If this wasn't you, your password is no longer safe - change it and tell your administrator.</strong></p>
                """;
            await _emailSender.SendAsync(email, "Approve a new device for your Ojas account", html);
        }
        catch (Exception ex)
        {
            _logger.LogWarning(ex, "Could not send device OTP to {Email}; the code was still generated.", email);
        }

        return code;
    }

    public async Task<string> SendPasswordResetOtpAsync(string email)
    {
        var code = GenerateCode();
        await StoreCodeAsync(email, OtpChannels.PasswordReset, code);

        try
        {
            var html = $"""
                <p>We received a request to reset the password on your Ojas account.</p>
                <p>Use this code to choose a new one:</p>
                <p style="font-size:28px;font-weight:700;letter-spacing:6px;">{code}</p>
                <p>This code expires in 10 minutes, and resetting your password signs you out on every device.</p>
                <p>If you didn't request this, you can ignore this email - your password hasn't changed.</p>
                """;
            await _emailSender.SendAsync(email, "Reset your Ojas password", html);
        }
        catch (Exception ex)
        {
            _logger.LogWarning(ex, "Could not send password reset OTP to {Email}; the code was still generated.", email);
        }

        return code;
    }

    /// <summary>The code a signed-in customer is sent to prove they receive mail at an address -
    /// either the one already on their account (channel EmailConfirm) or one they want to move it
    /// to (EmailChange). The target is bound to the account as well as the address, so a code sent
    /// for one account can never be redeemed by another, even for the same address.</summary>
    public async Task<string> SendContactEmailOtpAsync(string userId, string email, string channel)
    {
        var code = GenerateCode();
        await StoreCodeAsync(ContactEmailTarget(userId, email), channel, code);

        try
        {
            var html = $"""
                <p>Use this code to confirm this email address for your Ojas account:</p>
                <p style="font-size:28px;font-weight:700;letter-spacing:6px;">{code}</p>
                <p>This code expires in 10 minutes. If you didn't ask for it, you can ignore this email - nothing on any account will change.</p>
                """;
            await _emailSender.SendAsync(email, "Confirm your email for Ojas", html);
        }
        catch (Exception ex)
        {
            _logger.LogWarning(ex, "Could not send contact email OTP to {Email}; the code was still generated.", email);
        }

        return code;
    }

    public static string ContactEmailTarget(string userId, string email) => $"{userId}:{email}";

    public async Task<bool> VerifyAsync(string target, string channel, string code)
    {
        var normalizedTarget = Normalize(target);
        var filter = Builders<OtpCode>.Filter.And(
            Builders<OtpCode>.Filter.Eq(o => o.Target, normalizedTarget),
            Builders<OtpCode>.Filter.Eq(o => o.Channel, channel));

        var record = await _db.OtpCodes.Find(filter)
            .SortByDescending(o => o.CreatedAt)
            .FirstOrDefaultAsync();

        if (record == null)
            return false;

        // The attempt is counted BEFORE the code is checked, in one atomic update that also
        // refuses an expired or exhausted code. Checking first and counting afterwards let a
        // parallel burst of guesses all read the same stale count and all be checked.
        var now = DateTime.UtcNow;
        var reserved = await _db.OtpCodes.FindOneAndUpdateAsync(
            Builders<OtpCode>.Filter.And(
                Builders<OtpCode>.Filter.Eq(o => o.Id, record.Id),
                Builders<OtpCode>.Filter.Gt(o => o.ExpiresAt, now),
                Builders<OtpCode>.Filter.Lt(o => o.Attempts, MaxAttempts)),
            Builders<OtpCode>.Update.Inc(o => o.Attempts, 1));
        if (reserved == null)
            return false;

        if (!BCrypt.Net.BCrypt.Verify(code, record.CodeHash))
            return false;

        // Consumed - and only the request that actually deletes it wins, so two parallel
        // redemptions of the right code cannot both succeed.
        var consumed = await _db.OtpCodes.DeleteOneAsync(Builders<OtpCode>.Filter.Eq(o => o.Id, record.Id));
        return consumed.DeletedCount == 1;
    }

    private async Task StoreCodeAsync(string target, string channel, string code)
    {
        var normalizedTarget = Normalize(target);

        // Drop any earlier unconsumed code for this target/channel before issuing a new one,
        // so an old code can't still be verified alongside the fresh one.
        await _db.OtpCodes.DeleteManyAsync(Builders<OtpCode>.Filter.And(
            Builders<OtpCode>.Filter.Eq(o => o.Target, normalizedTarget),
            Builders<OtpCode>.Filter.Eq(o => o.Channel, channel)));

        var record = new OtpCode
        {
            Target = normalizedTarget,
            Channel = channel,
            CodeHash = BCrypt.Net.BCrypt.HashPassword(code),
            ExpiresAt = DateTime.UtcNow.Add(CodeLifetime),
        };
        await _db.OtpCodes.InsertOneAsync(record);
    }

    private static string Normalize(string target) => target.Trim().ToLowerInvariant();

    private static string GenerateCode() =>
        System.Security.Cryptography.RandomNumberGenerator.GetInt32(100000, 1000000).ToString();
}
