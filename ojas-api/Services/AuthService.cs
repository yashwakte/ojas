using System.IdentityModel.Tokens.Jwt;
using System.Security.Claims;
using System.Security.Cryptography;
using System.Text;
using Microsoft.IdentityModel.Tokens;
using MongoDB.Driver;
using OjasApi.Models;

namespace OjasApi.Services;

public class AuthService
{
    // Short-lived access token, meant to be silently renewed via the refresh token rather
    // than re-authenticated - a leaked one is only useful for a few minutes. The refresh
    // token is the one that's actually revocable (server-tracked, deleted on logout/rotation),
    // which is the capability a bare long-lived JWT never had.
    private const int AccessTokenMinutes = 15;
    private static readonly TimeSpan RefreshTokenLifetime = TimeSpan.FromDays(30);

    private readonly IMongoDbService _db;
    private readonly IConfiguration _config;
    private readonly DeviceService _devices;

    public AuthService(IMongoDbService db, IConfiguration config, DeviceService devices)
    {
        _db = db;
        _config = config;
        _devices = devices;
    }

    private static string NormalizeEmail(string email) => email.Trim().ToLowerInvariant();
    private static string NormalizePhone(string phone) => phone.Trim();

    public async Task<bool> EmailExistsAsync(string email) =>
        await _db.Users.Find(u => u.Email == NormalizeEmail(email)).AnyAsync();

    public async Task<bool> PhoneExistsAsync(string phone) =>
        await _db.Users.Find(u => u.Phone == NormalizePhone(phone)).AnyAsync();

    /// <summary>Creates the account but issues no session - the account isn't usable until
    /// the caller drives it through email OTP verification (see CompleteEmailVerificationAsync).</summary>
    public async Task<(User? User, string? ConflictField)> RegisterAsync(RegisterRequest request)
    {
        var normalizedEmail = NormalizeEmail(request.Email);
        var normalizedPhone = NormalizePhone(request.Phone);

        var byEmail = await _db.Users
            .Find(u => u.Email == normalizedEmail)
            .FirstOrDefaultAsync();
        if (byEmail != null)
            return (null, "email");

        var byPhone = await _db.Users
            .Find(u => u.Phone == normalizedPhone)
            .FirstOrDefaultAsync();
        if (byPhone != null)
            return (null, "phone");

        var user = new User
        {
            FullName = request.FullName.Trim(),
            Email = normalizedEmail,
            Phone = normalizedPhone,
            PasswordHash = BCrypt.Net.BCrypt.HashPassword(request.Password),
            Role = UserRoles.Customer
        };

        await _db.Users.InsertOneAsync(user);
        return (user, null);
    }

    /// <summary>Marks the account verified and issues a session. Called once an OTP has been
    /// confirmed - either right after registration, or when a user who abandoned that step
    /// comes back through the login screen.</summary>
    public async Task<AuthResult?> CompleteEmailVerificationAsync(string email)
    {
        var normalizedEmail = NormalizeEmail(email);
        var user = await _db.Users.Find(u => u.Email == normalizedEmail).FirstOrDefaultAsync();
        if (user == null)
            return null;

        if (!user.IsEmailVerified)
        {
            await _db.Users.UpdateOneAsync(
                Builders<User>.Filter.Eq(u => u.Id, user.Id),
                Builders<User>.Update.Set(u => u.IsEmailVerified, true));
            user.IsEmailVerified = true;
        }

        // Staff accounts are created already-verified, so this path only ever runs for
        // customers - no device to bind.
        return await IssueSessionAsync(user, null);
    }

    public async Task<LoginServiceResult> LoginAsync(LoginRequest request, string? rawDeviceId)
    {
        var user = await FindByCredentialsAsync(request.Email, request.Password);
        if (user == null)
            return new LoginServiceResult(LoginOutcome.InvalidCredentials);

        if (!user.IsEmailVerified)
            return new LoginServiceResult(LoginOutcome.NeedsEmailVerification);

        if (string.IsNullOrWhiteSpace(user.Role))
            user.Role = UserRoles.Customer;

        // Staff may only sign in from the single device bound to their account. Anything else -
        // an unbound account, a replaced phone, or someone with a stolen password on their own
        // machine - has to prove control of the account's email before a session is issued.
        if (DeviceService.IsRestrictedRole(user.Role) &&
            !await _devices.IsDeviceTrustedAsync(user.Id!, rawDeviceId))
        {
            return new LoginServiceResult(LoginOutcome.NeedsDeviceEnrollment);
        }

        var deviceIdHash = DeviceService.IsRestrictedRole(user.Role) && rawDeviceId != null
            ? DeviceService.HashDeviceId(rawDeviceId)
            : null;

        return new LoginServiceResult(LoginOutcome.Success, await IssueSessionAsync(user, deviceIdHash));
    }

    /// <summary>Shared by login and the device-enrollment endpoints, which re-check the password
    /// rather than carrying a half-authenticated session between the two steps.</summary>
    public async Task<User?> FindByCredentialsAsync(string email, string password)
    {
        var normalizedEmail = NormalizeEmail(email);
        var user = await _db.Users.Find(u => u.Email == normalizedEmail).FirstOrDefaultAsync();

        // A staff account whose invite hasn't been accepted has no password yet. Bail before
        // BCrypt.Verify, which throws rather than returning false on an empty hash.
        if (user == null || string.IsNullOrEmpty(user.PasswordHash))
            return null;

        if (!BCrypt.Net.BCrypt.Verify(password, user.PasswordHash))
            return null;

        return user;
    }

    /// <summary>Binds the calling device to a staff account and issues a session on it. Because
    /// the cap is one device, this replaces whatever was bound before and logs that device out.</summary>
    public async Task<AuthResult> EnrollDeviceAndIssueSessionAsync(
        User user, string deviceLabel, string? presentedRawDeviceId)
    {
        var rawDeviceId = await _devices.EnrollDeviceAsync(
            user.Id!, deviceLabel, DeviceEnrollmentMethods.EmailOtp, presentedRawDeviceId);
        var result = await IssueSessionAsync(user, DeviceService.HashDeviceId(rawDeviceId));
        return result with { RawDeviceId = rawDeviceId };
    }

    private async Task<AuthResult> IssueSessionAsync(User user, string? deviceIdHash)
    {
        var token = GenerateToken(user);
        var refreshToken = await IssueRefreshTokenAsync(user.Id!, deviceIdHash);
        return new AuthResult(
            token,
            new AuthResponse(user.Id!, user.FullName, user.Email, user.Phone, user.Role),
            refreshToken);
    }

    // Email verification enforcement ships from here on. Accounts created before this date
    // never went through an OTP step, so they're grandfathered in rather than locked out -
    // this only ever widens who *can* log in, never narrows it, and only touches accounts
    // that predate the cutoff, so it can safely run on every startup.
    private static readonly DateTime EmailVerificationEnforcedFrom = new(2026, 8, 17, 0, 0, 0, DateTimeKind.Utc);

    public async Task GrandfatherPreExistingUsersAsync()
    {
        var filter = Builders<User>.Filter.And(
            Builders<User>.Filter.Eq(u => u.IsEmailVerified, false),
            Builders<User>.Filter.Lt(u => u.CreatedAt, EmailVerificationEnforcedFrom));

        await _db.Users.UpdateManyAsync(filter, Builders<User>.Update.Set(u => u.IsEmailVerified, true));
    }

    /// <summary>
    /// Sets a new password and ends every existing session by revoking all refresh tokens - if
    /// the reset was triggered by someone who had gained access, this is what actually evicts
    /// them rather than leaving their session alive for another 30 days.
    ///
    /// Staff device bindings are deliberately left intact. Keeping them means a compromised
    /// email inbox still isn't enough to reach an admin account: whoever resets the password
    /// must also be on the bound device to use it.
    /// </summary>
    public async Task<bool> ResetPasswordAsync(string email, string newPassword)
    {
        var normalizedEmail = NormalizeEmail(email);
        var user = await _db.Users.Find(u => u.Email == normalizedEmail).FirstOrDefaultAsync();
        if (user == null)
            return false;

        await _db.Users.UpdateOneAsync(
            Builders<User>.Filter.Eq(u => u.Id, user.Id),
            Builders<User>.Update
                .Set(u => u.PasswordHash, BCrypt.Net.BCrypt.HashPassword(newPassword))
                // An account that never finished email verification has now proven control of
                // the address by redeeming a code sent to it, so there's nothing left to verify.
                .Set(u => u.IsEmailVerified, true));

        await RevokeAllRefreshTokensForUserAsync(user.Id!);
        return true;
    }

    public async Task MarkPhoneVerifiedAsync(string userId)
    {
        await _db.Users.UpdateOneAsync(
            Builders<User>.Filter.Eq(u => u.Id, userId),
            Builders<User>.Update.Set(u => u.IsPhoneVerified, true));
    }

    /// <summary>
    /// Creates the account dormant - no password at all. It can't be signed into until the staff
    /// member accepts their emailed invite and sets one, which means an admin never handles
    /// somebody else's credentials.
    /// </summary>
    public async Task<(User? Staff, string? ConflictField, string? Error)> CreateStaffAsync(CreateStaffRequest request)
    {
        var normalizedRole = request.Role.Trim().ToLowerInvariant();
        if (normalizedRole is not (UserRoles.Admin or UserRoles.Delivery))
            return (null, null, "Role must be either 'admin' or 'delivery'.");

        var normalizedEmail = NormalizeEmail(request.Email);
        var normalizedPhone = NormalizePhone(request.Phone);

        var byEmail = await _db.Users.Find(u => u.Email == normalizedEmail).FirstOrDefaultAsync();
        if (byEmail != null)
            return (null, "email", null);

        var byPhone = await _db.Users.Find(u => u.Phone == normalizedPhone).FirstOrDefaultAsync();
        if (byPhone != null)
            return (null, "phone", null);

        var user = new User
        {
            FullName = request.FullName.Trim(),
            Email = normalizedEmail,
            Phone = normalizedPhone,
            PasswordHash = string.Empty,
            Role = normalizedRole,
            // The invite link is sent to this address, so accepting it proves the address works.
            IsEmailVerified = true,
            IsPhoneVerified = true
        };

        await _db.Users.InsertOneAsync(user);
        return (user, null, null);
    }

    /// <summary>
    /// Sets the password on a dormant account and binds the device it was accepted on, in one
    /// step. Opening a single-use link sent to the account's own address proves control of that
    /// address just as an emailed code would, so there's nothing left for a separate device
    /// approval to establish.
    /// </summary>
    public async Task<AuthResult> AcceptInviteAsync(User user, string password, string deviceLabel, string? presentedRawDeviceId)
    {
        var passwordHash = BCrypt.Net.BCrypt.HashPassword(password);
        await _db.Users.UpdateOneAsync(
            Builders<User>.Filter.Eq(u => u.Id, user.Id),
            Builders<User>.Update.Set(u => u.PasswordHash, passwordHash));
        user.PasswordHash = passwordHash;

        var rawDeviceId = await _devices.EnrollDeviceAsync(
            user.Id!, deviceLabel, DeviceEnrollmentMethods.Invite, presentedRawDeviceId);
        var result = await IssueSessionAsync(user, DeviceService.HashDeviceId(rawDeviceId));
        return result with { RawDeviceId = rawDeviceId };
    }

    public async Task<User?> FindByIdAsync(string userId) =>
        await _db.Users.Find(u => u.Id == userId).FirstOrDefaultAsync();

    // Lets the very first admin account be created through the API instead of a manual
    // Atlas edit. Self-disables the moment any admin exists, so it can't be used as a
    // standing backdoor once the team has a real admin account.
    public async Task<(AuthResult? Result, string? ConflictField, string? Error)> BootstrapAdminAsync(
        RegisterRequest request,
        string deviceLabel,
        string? presentedRawDeviceId)
    {
        var adminExists = await _db.Users.Find(u => u.Role == UserRoles.Admin).AnyAsync();
        if (adminExists)
            return (null, null, "An admin account already exists; this endpoint is now disabled.");

        var normalizedEmail = NormalizeEmail(request.Email);
        var normalizedPhone = NormalizePhone(request.Phone);

        var byEmail = await _db.Users.Find(u => u.Email == normalizedEmail).FirstOrDefaultAsync();
        if (byEmail != null)
            return (null, "email", null);

        var byPhone = await _db.Users.Find(u => u.Phone == normalizedPhone).FirstOrDefaultAsync();
        if (byPhone != null)
            return (null, "phone", null);

        var user = new User
        {
            FullName = request.FullName.Trim(),
            Email = normalizedEmail,
            Phone = normalizedPhone,
            PasswordHash = BCrypt.Net.BCrypt.HashPassword(request.Password),
            Role = UserRoles.Admin,
            IsEmailVerified = true,
            IsPhoneVerified = true
        };

        await _db.Users.InsertOneAsync(user);

        // The machine that bootstraps the first admin is, by definition, a trusted one - binding
        // it here means the very first admin never has to enrol through email OTP, and there is
        // never a window where an admin account exists with no device bound to it.
        var rawDeviceId = await _devices.EnrollDeviceAsync(
            user.Id!, deviceLabel, DeviceEnrollmentMethods.Bootstrap, presentedRawDeviceId);
        var result = await IssueSessionAsync(user, DeviceService.HashDeviceId(rawDeviceId));
        return (result with { RawDeviceId = rawDeviceId }, null, null);
    }

    private string GenerateToken(User user)
    {
        var role = string.IsNullOrWhiteSpace(user.Role) ? UserRoles.Customer : user.Role;

        var key = new SymmetricSecurityKey(
            Encoding.UTF8.GetBytes(_config["Jwt:Key"]!));
        var credentials = new SigningCredentials(key, SecurityAlgorithms.HmacSha256);

        var claims = new[]
        {
            new Claim(ClaimTypes.NameIdentifier, user.Id!),
            new Claim(ClaimTypes.Email, user.Email),
            new Claim(ClaimTypes.Name, user.FullName),
            new Claim("phone", user.Phone),
            new Claim(ClaimTypes.Role, role),
        };

        var token = new JwtSecurityToken(
            issuer: _config["Jwt:Issuer"],
            audience: _config["Jwt:Audience"],
            claims: claims,
            expires: DateTime.UtcNow.AddMinutes(AccessTokenMinutes),
            signingCredentials: credentials
        );

        return new JwtSecurityTokenHandler().WriteToken(token);
    }

    private async Task<string> IssueRefreshTokenAsync(string userId, string? deviceIdHash = null)
    {
        var rawToken = Convert.ToHexString(RandomNumberGenerator.GetBytes(32));
        var record = new RefreshToken
        {
            TokenHash = HashToken(rawToken),
            UserId = userId,
            DeviceIdHash = deviceIdHash,
            ExpiresAt = DateTime.UtcNow.Add(RefreshTokenLifetime),
        };
        await _db.RefreshTokens.InsertOneAsync(record);
        return rawToken;
    }

    /// <summary>Verifies the presented refresh token, then rotates it - the old one is deleted
    /// and a new one issued alongside the new access token, so a stolen-but-unused refresh
    /// token stops working the moment the legitimate owner's client refreshes again.</summary>
    public async Task<AuthResult?> RefreshAsync(string rawRefreshToken, string? rawDeviceId)
    {
        var tokenHash = HashToken(rawRefreshToken);
        var record = await _db.RefreshTokens.Find(r => r.TokenHash == tokenHash).FirstOrDefaultAsync();
        if (record == null || record.ExpiresAt < DateTime.UtcNow)
            return null;

        var user = await _db.Users.Find(u => u.Id == record.UserId).FirstOrDefaultAsync();
        if (user == null)
            return null;

        // Without this, a refresh token lifted from a staff session would keep minting access
        // tokens on the attacker's machine for the next 30 days, silently bypassing the whole
        // device restriction - the token itself must be pinned to the device it was issued to,
        // and that device must still be the bound one.
        if (DeviceService.IsRestrictedRole(user.Role))
        {
            if (string.IsNullOrWhiteSpace(rawDeviceId) ||
                record.DeviceIdHash != DeviceService.HashDeviceId(rawDeviceId) ||
                !await _devices.IsDeviceTrustedAsync(user.Id!, rawDeviceId))
            {
                return null;
            }
        }

        await _db.RefreshTokens.DeleteOneAsync(r => r.TokenHash == tokenHash);

        var newRefreshToken = await IssueRefreshTokenAsync(user.Id!, record.DeviceIdHash);
        return new AuthResult(
            GenerateToken(user),
            new AuthResponse(user.Id!, user.FullName, user.Email, user.Phone, user.Role),
            newRefreshToken);
    }

    public async Task RevokeRefreshTokenAsync(string rawRefreshToken)
    {
        await _db.RefreshTokens.DeleteOneAsync(r => r.TokenHash == HashToken(rawRefreshToken));
    }

    /// <summary>Not called anywhere yet - available for a future "log out of all devices"
    /// action or as a defensive measure on password change.</summary>
    public async Task RevokeAllRefreshTokensForUserAsync(string userId)
    {
        await _db.RefreshTokens.DeleteManyAsync(r => r.UserId == userId);
    }

    private static string HashToken(string token) =>
        Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(token)));
}
