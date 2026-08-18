using System.Security.Cryptography;
using System.Text;
using MongoDB.Driver;
using OjasApi.Models;

namespace OjasApi.Services;

/// <summary>
/// Issues and redeems the single-use links that let a new staff member set their own password.
/// Kept separate from AuthService because it owns a distinct lifecycle - create, email, redeem
/// or expire - rather than anything to do with an established session.
/// </summary>
public class StaffInviteService
{
    private static readonly TimeSpan InviteLifetime = TimeSpan.FromHours(48);

    private readonly IMongoDbService _db;
    private readonly IEmailSender _emailSender;
    private readonly IConfiguration _config;
    private readonly ILogger<StaffInviteService> _logger;

    public StaffInviteService(
        IMongoDbService db,
        IEmailSender emailSender,
        IConfiguration config,
        ILogger<StaffInviteService> logger)
    {
        _db = db;
        _emailSender = emailSender;
        _config = config;
        _logger = logger;
    }

    private static string HashToken(string token) =>
        Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(token)));

    /// <summary>
    /// Replaces any outstanding invite for this user with a fresh one and emails the link.
    /// Returns the raw token so callers outside Production can surface it for testing, the same
    /// devCode convenience the OTP flows use.
    /// </summary>
    public async Task<string> IssueAsync(User user)
    {
        // Only ever one live invite per account, so a resend immediately invalidates the link
        // from the previous email rather than leaving two working at once.
        await _db.StaffInvites.DeleteManyAsync(i => i.UserId == user.Id);

        var rawToken = Convert.ToHexString(RandomNumberGenerator.GetBytes(32));
        await _db.StaffInvites.InsertOneAsync(new StaffInvite
        {
            TokenHash = HashToken(rawToken),
            UserId = user.Id!,
            ExpiresAt = DateTime.UtcNow.Add(InviteLifetime),
        });

        await SendInviteEmailAsync(user, rawToken);
        return rawToken;
    }

    private async Task SendInviteEmailAsync(User user, string rawToken)
    {
        var baseUrl = (_config["Frontend:BaseUrl"] ?? "http://localhost:4200").TrimEnd('/');
        var link = $"{baseUrl}/accept-invite?token={Uri.EscapeDataString(rawToken)}";
        var roleLabel = user.Role == UserRoles.Admin ? "administrator" : "delivery partner";

        try
        {
            var html = $"""
                <p>Hello {System.Net.WebUtility.HtmlEncode(user.FullName)},</p>
                <p>An Ojas {roleLabel} account has been created for you. Use the link below to
                choose your password and finish setting it up:</p>
                <p><a href="{link}" style="display:inline-block;padding:12px 20px;background:#F25A1A;color:#fff;border-radius:8px;text-decoration:none;font-weight:600;">Set up my account</a></p>
                <p>Or paste this into your browser:<br /><span style="word-break:break-all;">{link}</span></p>
                <p>This link works once and expires in 48 hours.</p>
                <p><strong>Open it on the phone or computer you'll actually use for work</strong> -
                that device becomes the one your account is allowed to sign in from.</p>
                """;
            await _emailSender.SendAsync(user.Email, "Set up your Ojas staff account", html);
        }
        catch (Exception ex)
        {
            // Same posture as the OTP senders: the invite is already stored and valid, so a
            // delivery failure is recoverable by resending rather than a reason to fail the
            // whole staff-creation request.
            _logger.LogWarning(ex, "Could not send staff invite to {Email}; the invite is still valid.", user.Email);
        }
    }

    /// <summary>Resolves a presented token to its user, without consuming it - used to show who
    /// the invite is for before they commit to a password.</summary>
    public async Task<User?> ResolveAsync(string rawToken)
    {
        var invite = await _db.StaffInvites
            .Find(i => i.TokenHash == HashToken(rawToken))
            .FirstOrDefaultAsync();

        if (invite == null || invite.ExpiresAt < DateTime.UtcNow)
            return null;

        return await _db.Users.Find(u => u.Id == invite.UserId).FirstOrDefaultAsync();
    }

    /// <summary>Burns the invite. Called once the password has actually been set, so a failure
    /// partway through doesn't leave the staff member holding a dead link and no account.</summary>
    public async Task ConsumeAsync(string rawToken) =>
        await _db.StaffInvites.DeleteOneAsync(i => i.TokenHash == HashToken(rawToken));

    public async Task<bool> HasPendingInviteAsync(string userId) =>
        await _db.StaffInvites.Find(i => i.UserId == userId).AnyAsync();
}
