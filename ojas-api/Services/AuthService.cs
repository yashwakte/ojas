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

    // How long a session may live. Two clocks, not one, because they answer different questions.
    //
    // The **idle window** is how long a session survives without being used, and it slides: every
    // refresh pushes it out again. This is the one that has to be generous enough to cover a
    // working day, because expiring it against the wall clock rather than against use is simply
    // wrong - an admin who signs in at noon and comes back to their desk at 7:50pm should not be
    // thrown out at 8pm mid-task. They are actively working; the session is not abandoned.
    //
    // The **absolute ceiling** is the longest a single sign-in may live no matter how much it is
    // used, and it does not slide. It is the half that actually constrains a thief: an idle window
    // on its own renews forever as long as the stolen token keeps being used.
    //
    // Staff are tighter on both counts. An admin session reads every customer's data and can change
    // prices; a delivery session sees addresses and phone numbers. Those live on phones that get
    // shared, lost and left unlocked, so one sign-in covers a shift and a day at the outside.
    private static readonly TimeSpan CustomerIdleWindow = TimeSpan.FromHours(24);
    private static readonly TimeSpan CustomerAbsoluteSessionLifetime = TimeSpan.FromDays(7);
    private static readonly TimeSpan StaffIdleWindow = TimeSpan.FromHours(8);
    private static readonly TimeSpan StaffAbsoluteSessionLifetime = TimeSpan.FromHours(24);

    /// <summary>The longest any session of this role can run, used for cookie expiry too.</summary>
    public static TimeSpan MaxSessionLifetimeFor(string? role) => AbsoluteLifetimeFor(role);

    private static TimeSpan RollingLifetimeFor(string? role) =>
        DeviceService.IsRestrictedRole(role) ? StaffIdleWindow : CustomerIdleWindow;

    private static TimeSpan AbsoluteLifetimeFor(string? role) =>
        DeviceService.IsRestrictedRole(role) ? StaffAbsoluteSessionLifetime : CustomerAbsoluteSessionLifetime;

    /// <summary>
    /// When a token issued now must expire: the idle window from this moment, but never later
    /// than the absolute ceiling measured from the original sign-in. Whichever comes first.
    /// </summary>
    private static DateTime RefreshTokenExpiryFor(string? role, DateTime familyStartedAt)
    {
        var rolling = DateTime.UtcNow.Add(RollingLifetimeFor(role));
        var absolute = familyStartedAt.Add(AbsoluteLifetimeFor(role));
        return rolling < absolute ? rolling : absolute;
    }

    // How long after a refresh token is spent a second presentation of it still reads as two
    // tabs racing rather than as theft. Long enough to cover a slow request against a cold
    // Render instance; far shorter than any window an attacker could rely on.
    private static readonly TimeSpan RotationGrace = TimeSpan.FromSeconds(60);

    // How long a spent token stays on file so that reuse remains detectable. Beyond this the
    // TTL index removes it and a replay simply looks unknown, which is a 401 either way.
    private static readonly TimeSpan ReuseDetectionWindow = TimeSpan.FromDays(7);

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

    /// <summary>Whether SendPhoneLoginOtpAsync should actually be triggered for this number.
    /// Deliberately staff-excluded: phone login has no device concept, so allowing it for
    /// admin/delivery would let anyone with the phone bypass the single-device restriction
    /// entirely from any browser. Also gated on IsEmailVerified so a code can't hand a session
    /// to an account that never finished registration.</summary>
    public async Task<bool> IsLoginablePhoneAsync(string phone)
    {
        var normalizedPhone = NormalizePhone(phone);
        return await _db.Users
            .Find(u => u.Phone == normalizedPhone && u.Role == UserRoles.Customer && u.IsEmailVerified)
            .AnyAsync();
    }

    /// <summary>Issues a session for the customer owning this phone number. Re-checks the same
    /// eligibility IsLoginablePhoneAsync enforces (customer role, email verified) rather than
    /// assuming a code could only have reached here for an eligible number: that assumption held
    /// when Ojas's own backend controlled sending, but the MSG91 OTP Widget sends directly from
    /// the browser, bypassing IsLoginablePhoneAsync entirely unless the widget's own "User
    /// Existence Validation" hook is both enabled and correctly wired. That hook is a UX
    /// nicety - not sending an OTP nobody eligible could redeem - not the actual security
    /// boundary; this check is.</summary>
    public async Task<AuthResult?> PhoneLoginAsync(string phone)
    {
        var normalizedPhone = NormalizePhone(phone);
        var user = await _db.Users
            .Find(u => u.Phone == normalizedPhone && u.Role == UserRoles.Customer && u.IsEmailVerified)
            .FirstOrDefaultAsync();

        if (user == null)
            return null;

        // Not device-restricted - only staff are.
        return await IssueSessionAsync(user, null);
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

    // Long enough that a staff member locked out overnight can act on it the next morning;
    // short enough that a forgotten approval doesn't sit open indefinitely. Grants password-only
    // enrollment, so it deliberately doesn't linger the way a normal OTP window (10 minutes)
    // wouldn't need to.
    private static readonly TimeSpan DeviceApprovalLifetime = TimeSpan.FromHours(12);

    /// <summary>Grants this staff account's next device enrollment with no OTP email required.
    /// Only ever reachable by an already-authenticated admin, which is where the trust comes
    /// from - see PreApprovedEnrollRequest.</summary>
    public async Task<DateTime> ApproveNextDeviceAsync(string userId)
    {
        var expiresAt = DateTime.UtcNow.Add(DeviceApprovalLifetime);
        await _db.Users.UpdateOneAsync(
            Builders<User>.Filter.Eq(u => u.Id, userId),
            Builders<User>.Update.Set(u => u.PendingDeviceApprovalExpiresAt, expiresAt));
        return expiresAt;
    }

    public static bool HasActiveDeviceApproval(User user) =>
        user.PendingDeviceApprovalExpiresAt is { } expiresAt && expiresAt > DateTime.UtcNow;

    /// <summary>Redeems a standing admin approval instead of an OTP code. Consumes it either way
    /// - even a failed/expired check clears a stale grant rather than leaving it to be found
    /// later - so this is safe to call speculatively once the caller already has credentials.</summary>
    public async Task<AuthResult?> EnrollPreApprovedDeviceAsync(
        User user, string deviceLabel, string? presentedRawDeviceId)
    {
        var wasApproved = HasActiveDeviceApproval(user);

        await _db.Users.UpdateOneAsync(
            Builders<User>.Filter.Eq(u => u.Id, user.Id),
            Builders<User>.Update.Set(u => u.PendingDeviceApprovalExpiresAt, null));

        if (!wasApproved)
            return null;

        var rawDeviceId = await _devices.EnrollDeviceAsync(
            user.Id!, deviceLabel, DeviceEnrollmentMethods.AdminPreApproval, presentedRawDeviceId);
        var result = await IssueSessionAsync(user, DeviceService.HashDeviceId(rawDeviceId));
        return result with { RawDeviceId = rawDeviceId };
    }

    private async Task<AuthResult> IssueSessionAsync(User user, string? deviceIdHash)
    {
        var token = GenerateToken(user);
        var refreshToken = await IssueRefreshTokenAsync(user.Id!, user.Role, deviceIdHash);
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

    private async Task<string> IssueRefreshTokenAsync(
        string userId,
        string? role,
        string? deviceIdHash = null,
        string? familyId = null,
        DateTime? familyStartedAt = null)
    {
        // A rotation inherits the original sign-in's timestamp; a fresh sign-in starts the clock.
        // Inheriting it is what stops a session from renewing itself past its ceiling.
        var startedAt = familyStartedAt ?? DateTime.UtcNow;

        var rawToken = Convert.ToHexString(RandomNumberGenerator.GetBytes(32));
        var record = new RefreshToken
        {
            TokenHash = HashToken(rawToken),
            UserId = userId,
            // A fresh sign-in starts a new family; a rotation continues the one it came from.
            FamilyId = familyId ?? Guid.NewGuid().ToString("N"),
            DeviceIdHash = deviceIdHash,
            FamilyStartedAt = startedAt,
            ExpiresAt = RefreshTokenExpiryFor(role, startedAt),
        };
        await _db.RefreshTokens.InsertOneAsync(record);
        return rawToken;
    }

    /// <summary>Verifies the presented refresh token and rotates it: a successor is issued in
    /// the same family alongside the new access token, so a stolen-but-unused refresh token
    /// stops working the moment the legitimate owner's client refreshes again.
    ///
    /// The spent token is marked rather than deleted, which is what makes the three cases below
    /// distinguishable at all.
    ///
    /// <para><b>Rotation.</b> The mark is claimed with a conditional update rather than written
    /// after the earlier read, because two tabs can read the same unrotated row at the same
    /// instant. Exactly one caller wins that update, and only the winner mints a successor.</para>
    ///
    /// <para><b>Grace replay.</b> Two tabs in one browser share a cookie jar, so when the access
    /// token expires they both notice and both refresh with the same value. That is ordinary,
    /// honest behaviour and must not sign anyone out. The loser gets a fresh access token and
    /// deliberately <em>no</em> refresh token: the jar already holds the successor the winner was
    /// issued, so the tabs converge on one token instead of forking into two independently
    /// rotating branches. That distinction is the whole security of the grace window - a fork
    /// would hand a token thief a session that renews itself forever and never trips the check
    /// below, whereas this grants at most one more access token, which expires in minutes and
    /// cannot be renewed.</para>
    ///
    /// <para><b>Reuse.</b> Presented again after the grace window, nobody's browser sits on a
    /// spent token for a minute and then tries it. Someone else has a copy, and the thief's
    /// request can't be told apart from the owner's, so the only safe move is to revoke the
    /// entire family: every token descended from that sign-in dies and the real user signs in
    /// again. Their other browsers and devices have their own families and are untouched.</para>
    /// </summary>
    public async Task<RefreshResult> RefreshAsync(string rawRefreshToken, string? rawDeviceId)
    {
        var tokenHash = HashToken(rawRefreshToken);
        var record = await _db.RefreshTokens.Find(r => r.TokenHash == tokenHash).FirstOrDefaultAsync();
        if (record == null || record.ExpiresAt < DateTime.UtcNow)
            return new RefreshResult(RefreshOutcome.Invalid);

        // Rows written before families existed have no family id; treat such a token as a
        // family of one so revoking it still means something.
        var familyId = record.FamilyId ?? record.TokenHash;

        if (record.RotatedAt is { } rotatedAt && DateTime.UtcNow - rotatedAt > RotationGrace)
        {
            await RevokeFamilyAsync(familyId);
            return new RefreshResult(RefreshOutcome.ReuseDetected);
        }

        var user = await _db.Users.Find(u => u.Id == record.UserId).FirstOrDefaultAsync();
        if (user == null)
            return new RefreshResult(RefreshOutcome.Invalid);

        // The absolute ceiling, re-checked against the user's *current* role rather than the
        // role they had when the token was minted. Promoting someone to admin has to shorten
        // their existing session immediately; leaving them on a customer's 30-day window until
        // it happens to lapse would be a standing hole every promotion quietly opens.
        if (record.FamilyStartedAt is { } startedAt &&
            DateTime.UtcNow > startedAt.Add(AbsoluteLifetimeFor(user.Role)))
        {
            await RevokeFamilyAsync(familyId);
            return new RefreshResult(RefreshOutcome.Invalid);
        }

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
                return new RefreshResult(RefreshOutcome.Invalid);
            }
        }

        var userResponse = new AuthResponse(user.Id!, user.FullName, user.Email, user.Phone, user.Role);

        // Claim the rotation. The row is marked rather than deleted so a later replay is still
        // recognisable, and its own expiry is pulled in to ReuseDetectionWindow so the evidence
        // self-cleans through the existing TTL index instead of lingering for the full 30 days.
        var spentUntil = DateTime.UtcNow.Add(ReuseDetectionWindow);
        var claimed = await _db.RefreshTokens.FindOneAndUpdateAsync(
            Builders<RefreshToken>.Filter.And(
                Builders<RefreshToken>.Filter.Eq(r => r.TokenHash, tokenHash),
                Builders<RefreshToken>.Filter.Eq(r => r.RotatedAt, null)),
            Builders<RefreshToken>.Update
                .Set(r => r.RotatedAt, DateTime.UtcNow)
                .Set(r => r.ExpiresAt, record.ExpiresAt < spentUntil ? record.ExpiresAt : spentUntil));

        if (claimed == null)
            return new RefreshResult(
                RefreshOutcome.Success,
                new AuthResult(GenerateToken(user), userResponse, string.Empty),
                IsGraceReplay: true);

        // The successor inherits the original sign-in's timestamp, so the ceiling holds however
        // many times the session is refreshed. A row written before this field existed has no
        // timestamp to inherit; starting its clock now gives those sessions one more full window
        // rather than signing everyone out the moment this ships.
        var newRefreshToken = await IssueRefreshTokenAsync(
            user.Id!, user.Role, record.DeviceIdHash, familyId, record.FamilyStartedAt ?? DateTime.UtcNow);
        return new RefreshResult(
            RefreshOutcome.Success,
            new AuthResult(GenerateToken(user), userResponse, newRefreshToken));
    }

    /// <summary>Signs this browser out. Revoking the whole family rather than the single
    /// presented token matters because rotation's grace window can leave a sibling successor
    /// alive in another tab - deleting only what was handed in would leave that sibling able to
    /// keep minting access tokens after the user pressed Log out.</summary>
    public async Task RevokeRefreshTokenAsync(string rawRefreshToken)
    {
        var tokenHash = HashToken(rawRefreshToken);
        var record = await _db.RefreshTokens.Find(r => r.TokenHash == tokenHash).FirstOrDefaultAsync();

        if (record == null)
        {
            await _db.RefreshTokens.DeleteOneAsync(r => r.TokenHash == tokenHash);
            return;
        }

        await RevokeFamilyAsync(record.FamilyId ?? record.TokenHash);
    }

    /// <summary>Deletes every token descended from one sign-in. Matches on the family id or on
    /// the row's own hash, so a legacy row with no family id is still caught by its own id.</summary>
    private async Task RevokeFamilyAsync(string familyId)
    {
        await _db.RefreshTokens.DeleteManyAsync(r => r.FamilyId == familyId || r.TokenHash == familyId);
    }

    /// <summary>Signs the user out everywhere, on every device. Used when a staff device binding
    /// moves, and available as a defensive measure on password change.</summary>
    public async Task RevokeAllRefreshTokensForUserAsync(string userId)
    {
        await _db.RefreshTokens.DeleteManyAsync(r => r.UserId == userId);
    }

    private static string HashToken(string token) =>
        Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(token)));
}
