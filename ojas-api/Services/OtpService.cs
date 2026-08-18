using MongoDB.Driver;
using OjasApi.Models;

namespace OjasApi.Services;

public class OtpService
{
    private static readonly TimeSpan CodeLifetime = TimeSpan.FromMinutes(10);
    private const int MaxAttempts = 5;

    private readonly IMongoDbService _db;
    private readonly IEmailSender _emailSender;
    private readonly IPhoneOtpSender _phoneOtpSender;
    private readonly ILogger<OtpService> _logger;

    public OtpService(IMongoDbService db, IEmailSender emailSender, IPhoneOtpSender phoneOtpSender, ILogger<OtpService> logger)
    {
        _db = db;
        _emailSender = emailSender;
        _phoneOtpSender = phoneOtpSender;
        _logger = logger;
    }

    public bool IsPhoneOtpConfigured => _phoneOtpSender.IsConfigured;

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

    public async Task<string> SendPhoneOtpAsync(string phone)
    {
        if (!_phoneOtpSender.IsConfigured)
            throw new InvalidOperationException("Phone verification is not available yet.");

        var code = GenerateCode();
        await StoreCodeAsync(phone, OtpChannels.Phone, code);
        await _phoneOtpSender.SendAsync(phone, code);
        return code;
    }

    public async Task<bool> VerifyAsync(string target, string channel, string code)
    {
        var normalizedTarget = Normalize(target);
        var filter = Builders<OtpCode>.Filter.And(
            Builders<OtpCode>.Filter.Eq(o => o.Target, normalizedTarget),
            Builders<OtpCode>.Filter.Eq(o => o.Channel, channel));

        var record = await _db.OtpCodes.Find(filter)
            .SortByDescending(o => o.CreatedAt)
            .FirstOrDefaultAsync();

        if (record == null || record.ExpiresAt < DateTime.UtcNow || record.Attempts >= MaxAttempts)
            return false;

        var isMatch = BCrypt.Net.BCrypt.Verify(code, record.CodeHash);
        if (!isMatch)
        {
            await _db.OtpCodes.UpdateOneAsync(
                Builders<OtpCode>.Filter.Eq(o => o.Id, record.Id),
                Builders<OtpCode>.Update.Inc(o => o.Attempts, 1));
            return false;
        }

        // Consumed - delete so it can't be replayed.
        await _db.OtpCodes.DeleteOneAsync(Builders<OtpCode>.Filter.Eq(o => o.Id, record.Id));
        return true;
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
