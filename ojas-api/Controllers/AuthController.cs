using System.Security.Claims;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.RateLimiting;
using Microsoft.AspNetCore.Authorization;
using OjasApi.Models;
using OjasApi.Services;

namespace OjasApi.Controllers;

[ApiController]
[Route("api/[controller]")]
[EnableRateLimiting("auth")]
public class AuthController : ControllerBase
{
    private const string AuthCookieName = "ojas_auth";
    private const string CsrfCookieName = "ojas_csrf";
    private const string RefreshCookieName = "ojas_refresh";
    private const string DeviceCookieName = "ojas_device";

    // Deliberately long-lived: this cookie *is* the device binding, so it has to outlive
    // ordinary sessions - a staff member logging out at the end of a shift must not have to
    // re-enrol the next morning. 400 days is the maximum Chrome will honour.
    private static readonly TimeSpan DeviceCookieLifetime = TimeSpan.FromDays(400);

    // Must match AuthService's AccessTokenMinutes/RefreshTokenLifetime - these govern how long
    // the browser keeps offering each cookie, the token's own claims/hash-expiry are what the
    // server actually enforces.
    private const int AccessTokenMinutes = 15;
    private static readonly TimeSpan RefreshTokenLifetime = TimeSpan.FromDays(30);

    private readonly AuthService _authService;
    private readonly OtpService _otpService;
    private readonly DeviceService _deviceService;
    private readonly ITurnstileVerifier _turnstileVerifier;
    private readonly IWebHostEnvironment _env;
    private readonly ILogger<AuthController> _logger;

    public AuthController(
        AuthService authService,
        OtpService otpService,
        DeviceService deviceService,
        ITurnstileVerifier turnstileVerifier,
        IWebHostEnvironment env,
        ILogger<AuthController> logger)
    {
        _authService = authService;
        _otpService = otpService;
        _deviceService = deviceService;
        _turnstileVerifier = turnstileVerifier;
        _env = env;
        _logger = logger;
    }

    private string? RawDeviceId =>
        Request.Cookies.TryGetValue(DeviceCookieName, out var id) && !string.IsNullOrWhiteSpace(id)
            ? id
            : null;

    private string CurrentDeviceLabel =>
        DeviceService.DescribeDevice(Request.Headers.UserAgent.ToString());

    private Task<bool> VerifyTurnstileAsync(string token) =>
        _turnstileVerifier.VerifyAsync(token, HttpContext.Connection.RemoteIpAddress?.ToString());

    private CookieOptions BuildAuthCookieOptions() => new()
    {
        HttpOnly = true,
        Secure = true,
        SameSite = SameSiteMode.None,
        Path = "/",
        Expires = DateTimeOffset.UtcNow.AddMinutes(AccessTokenMinutes)
    };

    // Lives as long as the refresh token, not the access token - it needs to still be valid
    // whenever a silent /refresh call reissues a fresh access token partway through the session.
    private CookieOptions BuildCsrfCookieOptions() => new()
    {
        HttpOnly = false,
        Secure = true,
        SameSite = SameSiteMode.None,
        Path = "/",
        Expires = DateTimeOffset.UtcNow.Add(RefreshTokenLifetime)
    };

    // Scoped to /api/auth only (not "/") - it's never needed outside login/refresh/logout, so
    // there's no reason for it to ride along on every single API request.
    private CookieOptions BuildRefreshCookieOptions() => new()
    {
        HttpOnly = true,
        Secure = true,
        SameSite = SameSiteMode.None,
        Path = "/api/auth",
        Expires = DateTimeOffset.UtcNow.Add(RefreshTokenLifetime)
    };

    // HttpOnly is the whole point: script on the page can't read the device id, so an XSS bug
    // can't exfiltrate the thing that makes this device trusted. Scoped to /api/auth because
    // login, refresh and enrolment are the only endpoints that ever consult it.
    private CookieOptions BuildDeviceCookieOptions() => new()
    {
        HttpOnly = true,
        Secure = true,
        SameSite = SameSiteMode.None,
        Path = "/api/auth",
        Expires = DateTimeOffset.UtcNow.Add(DeviceCookieLifetime)
    };

    /// <summary>Sets the auth+CSRF+refresh cookies for a verified session and returns the
    /// response body every login-equivalent endpoint (login, register-verify, refresh,
    /// bootstrap-admin) shares.</summary>
    private AuthResponse IssueSession(AuthResult result)
    {
        var csrfToken = Convert.ToHexString(System.Security.Cryptography.RandomNumberGenerator.GetBytes(32));
        Response.Cookies.Append(AuthCookieName, result.Token, BuildAuthCookieOptions());
        Response.Cookies.Append(RefreshCookieName, result.RefreshToken, BuildRefreshCookieOptions());
        Response.Cookies.Append(CsrfCookieName, csrfToken, BuildCsrfCookieOptions());

        // Only set when this session also bound a new device (enrolment or first-admin
        // bootstrap); ordinary logins reuse the cookie the browser already holds.
        if (result.RawDeviceId != null)
            Response.Cookies.Append(DeviceCookieName, result.RawDeviceId, BuildDeviceCookieOptions());

        return result.User with { CsrfToken = csrfToken };
    }

    [HttpGet("ping")]
    [DisableRateLimiting]
    public IActionResult Ping() => Ok("pong");

    // Lightweight check the frontend calls once on app load so a session that
    // expired server-side (e.g. the browser was left open for days) is detected
    // immediately, instead of only surfacing the next time the user happens to
    // trigger an authenticated request.
    [HttpGet("session")]
    [Authorize]
    [DisableRateLimiting]
    public IActionResult Session() => Ok();

    [HttpGet("check-email")]
    [DisableRateLimiting]
    public async Task<IActionResult> CheckEmail([FromQuery] string email)
    {
        var exists = await _authService.EmailExistsAsync(email);
        return Ok(new { exists });
    }

    [HttpGet("check-phone")]
    [DisableRateLimiting]
    public async Task<IActionResult> CheckPhone([FromQuery] string phone)
    {
        var exists = await _authService.PhoneExistsAsync(phone);
        return Ok(new { exists });
    }

    // Creates the account but issues no session yet - VerifyEmailOtp is what actually logs
    // the user in, once they've proven the email address is real.
    [HttpPost("register")]
    public async Task<ActionResult<RegisterPendingResponse>> Register([FromBody] RegisterRequest request)
    {
        if (!await VerifyTurnstileAsync(request.TurnstileToken))
            return BadRequest(new { message = "Verification failed. Please try again." });

        var (user, conflictField) = await _authService.RegisterAsync(request);
        if (user == null)
        {
            var message = conflictField == "email"
                ? "Email already registered"
                : "Phone number already in use";
            return Conflict(new { message, field = conflictField });
        }

        var code = await _otpService.SendEmailOtpAsync(user.Email);
        var devCode = _env.IsProduction() ? null : code;
        return Ok(new RegisterPendingResponse(user.Email, "We've sent a 6-digit code to your email.", devCode));
    }

    [HttpPost("verify-email-otp")]
    public async Task<ActionResult<AuthResponse>> VerifyEmailOtp([FromBody] VerifyEmailOtpRequest request)
    {
        var isValid = await _otpService.VerifyAsync(request.Email, OtpChannels.Email, request.Code);
        if (!isValid)
            return BadRequest(new { message = "That code is invalid or has expired." });

        var result = await _authService.CompleteEmailVerificationAsync(request.Email);
        if (result == null)
            return NotFound();

        return Ok(IssueSession(result));
    }

    // Doesn't reveal whether the email is registered - always returns the same generic message.
    // (devCode does technically leak existence outside Production, same trade-off Register makes -
    // it's a local/dev testing convenience only, never populated once IsProduction() is true.)
    [HttpPost("resend-email-otp")]
    public async Task<IActionResult> ResendEmailOtp([FromBody] ResendEmailOtpRequest request)
    {
        string? devCode = null;
        if (await _authService.EmailExistsAsync(request.Email))
        {
            var code = await _otpService.SendEmailOtpAsync(request.Email);
            devCode = _env.IsProduction() ? null : code;
        }

        return Ok(new { message = "If that email is registered, a new code has been sent.", devCode });
    }

    [HttpPost("login")]
    public async Task<ActionResult<AuthResponse>> Login([FromBody] LoginRequest request)
    {
        if (!await VerifyTurnstileAsync(request.TurnstileToken))
            return BadRequest(new { message = "Verification failed. Please try again." });

        var login = await _authService.LoginAsync(request, RawDeviceId);

        switch (login.Outcome)
        {
            case LoginOutcome.NeedsEmailVerification:
                return StatusCode(StatusCodes.Status403Forbidden, new
                {
                    message = "Please verify your email before signing in.",
                    needsEmailVerification = true,
                    email = request.Email,
                });

            // Deliberately the same shape as the email-verification case: the password was
            // correct, but a session is withheld until the caller proves control of the
            // account's email from this device.
            case LoginOutcome.NeedsDeviceEnrollment:
                return StatusCode(StatusCodes.Status403Forbidden, new
                {
                    message = "This device isn't recognised. We'll email you a code to approve it.",
                    needsDeviceEnrollment = true,
                    email = request.Email,
                });

            case LoginOutcome.InvalidCredentials:
                return Unauthorized(new { message = "Invalid email or password" });

            default:
                return Ok(IssueSession(login.Auth!));
        }
    }

    // Called automatically by the frontend's HTTP interceptor whenever the access token has
    // expired, so it needs more headroom than the 5/min "auth" policy - a user with several
    // tabs open can otherwise trip that limit just from ordinary background use.
    [HttpPost("refresh")]
    [EnableRateLimiting("general")]
    public async Task<ActionResult<AuthResponse>> Refresh()
    {
        if (!Request.Cookies.TryGetValue(RefreshCookieName, out var rawRefreshToken) || string.IsNullOrWhiteSpace(rawRefreshToken))
            return Unauthorized();

        var result = await _authService.RefreshAsync(rawRefreshToken, RawDeviceId);
        if (result == null)
        {
            // Stale, expired, or already-rotated - clear it so the browser stops offering it.
            Response.Cookies.Delete(RefreshCookieName, new CookieOptions { Path = "/api/auth", Secure = true, SameSite = SameSiteMode.None });
            return Unauthorized();
        }

        return Ok(IssueSession(result));
    }

    [HttpPost("logout")]
    [DisableRateLimiting]
    public async Task<IActionResult> Logout()
    {
        if (Request.Cookies.TryGetValue(RefreshCookieName, out var rawRefreshToken) && !string.IsNullOrWhiteSpace(rawRefreshToken))
            await _authService.RevokeRefreshTokenAsync(rawRefreshToken);

        Response.Cookies.Delete(AuthCookieName, new CookieOptions
        {
            Path = "/",
            Secure = true,
            SameSite = SameSiteMode.None
        });
        Response.Cookies.Delete(CsrfCookieName, new CookieOptions
        {
            Path = "/",
            Secure = true,
            SameSite = SameSiteMode.None
        });
        Response.Cookies.Delete(RefreshCookieName, new CookieOptions
        {
            Path = "/api/auth",
            Secure = true,
            SameSite = SameSiteMode.None
        });
        return NoContent();
    }

    // One-time bootstrap for the first admin account. Works only while the Users
    // collection has zero admins; every call after that returns 409, so this can be
    // left in the deployed API without acting as a standing backdoor.
    [HttpPost("bootstrap-admin")]
    public async Task<ActionResult<AuthResponse>> BootstrapAdmin([FromBody] RegisterRequest request)
    {
        if (!await VerifyTurnstileAsync(request.TurnstileToken))
            return BadRequest(new { message = "Verification failed. Please try again." });

        var (result, conflictField, error) = await _authService.BootstrapAdminAsync(
            request, CurrentDeviceLabel, RawDeviceId);
        if (error != null)
            return Conflict(new { message = error });

        if (result == null)
        {
            var message = conflictField == "email"
                ? "Email already registered"
                : "Phone number already in use";
            return Conflict(new { message, field = conflictField });
        }

        return Ok(IssueSession(result));
    }

    // Scaffolded ahead of MSG91/DLT registration - returns 503 until Msg91:* config is set,
    // at which point these become live with no code changes needed.
    [HttpPost("send-phone-otp")]
    [Authorize]
    public async Task<IActionResult> SendPhoneOtp()
    {
        if (!_otpService.IsPhoneOtpConfigured)
            return StatusCode(StatusCodes.Status503ServiceUnavailable, new { message = "Phone verification isn't available yet." });

        var phone = User.FindFirstValue("phone");
        if (string.IsNullOrWhiteSpace(phone))
            return BadRequest();

        await _otpService.SendPhoneOtpAsync(phone);
        return Ok(new { message = "Code sent." });
    }

    [HttpPost("verify-phone-otp")]
    [Authorize]
    public async Task<IActionResult> VerifyPhoneOtp([FromBody] VerifyPhoneOtpRequest request)
    {
        if (!_otpService.IsPhoneOtpConfigured)
            return StatusCode(StatusCodes.Status503ServiceUnavailable, new { message = "Phone verification isn't available yet." });

        var userId = User.FindFirstValue(ClaimTypes.NameIdentifier);
        if (userId == null)
            return Unauthorized();

        var isValid = await _otpService.VerifyAsync(request.Phone, OtpChannels.Phone, request.Code);
        if (!isValid)
            return BadRequest(new { message = "That code is invalid or has expired." });

        await _authService.MarkPhoneVerifiedAsync(userId);
        return Ok();
    }

    [HttpPost("staff")]
    [Authorize(Roles = UserRoles.Admin)]
    public async Task<ActionResult<StaffUserResponse>> CreateStaff([FromBody] CreateStaffRequest request)
    {
        var (staff, conflictField, error) = await _authService.CreateStaffAsync(request);
        if (error != null)
            return BadRequest(new { message = error });

        if (staff == null)
        {
            var message = conflictField == "email"
                ? "Email already registered"
                : "Phone number already in use";
            return Conflict(new { message, field = conflictField });
        }

        return Ok(staff);
    }

    /// <summary>Never reveals whether the address is registered - the response is identical
    /// either way, so this can't be used to enumerate accounts. Turnstile-gated because a
    /// correct password isn't required here, which would otherwise make it a free way to send
    /// mail to arbitrary addresses.</summary>
    [HttpPost("forgot-password")]
    public async Task<IActionResult> ForgotPassword([FromBody] ForgotPasswordRequest request)
    {
        if (!await VerifyTurnstileAsync(request.TurnstileToken))
            return BadRequest(new { message = "Verification failed. Please try again." });

        string? devCode = null;
        if (await _authService.EmailExistsAsync(request.Email))
        {
            var code = await _otpService.SendPasswordResetOtpAsync(request.Email);
            devCode = _env.IsProduction() ? null : code;
        }

        return Ok(new { message = "If that email is registered, we've sent a reset code.", devCode });
    }

    /// <summary>Redeems the code and sets the new password. Issues no session - the user signs
    /// in again afterwards, which for staff still means passing the device check.</summary>
    [HttpPost("reset-password")]
    public async Task<IActionResult> ResetPassword([FromBody] ResetPasswordRequest request)
    {
        var isValid = await _otpService.VerifyAsync(request.Email, OtpChannels.PasswordReset, request.Code);
        if (!isValid)
            return BadRequest(new { message = "That code is invalid or has expired." });

        var reset = await _authService.ResetPasswordAsync(request.Email, request.NewPassword);
        if (!reset)
            return BadRequest(new { message = "That code is invalid or has expired." });

        _logger.LogInformation("Password reset completed for {Email}.", request.Email);
        return Ok(new { message = "Your password has been updated. Please sign in." });
    }

    /// <summary>Step one of moving a staff account to a new device. Requires the correct
    /// password, so it can't be used to spray codes at staff inboxes, and returns the same
    /// generic response either way so it never reveals whether an account exists.</summary>
    [HttpPost("device/send-otp")]
    public async Task<IActionResult> SendDeviceOtp([FromBody] DeviceOtpRequest request)
    {
        string? devCode = null;
        var user = await _authService.FindByCredentialsAsync(request.Email, request.Password);

        if (user != null && DeviceService.IsRestrictedRole(user.Role))
        {
            var code = await _otpService.SendDeviceOtpAsync(user.Email);
            devCode = _env.IsProduction() ? null : code;
        }

        return Ok(new { message = "If those details are correct, we've sent a code to your email.", devCode });
    }

    /// <summary>Step two: a correct code binds *this* device to the account and signs in. The
    /// password is re-checked rather than trusting anything carried over from step one.</summary>
    [HttpPost("device/enroll")]
    public async Task<ActionResult<AuthResponse>> EnrollDevice([FromBody] EnrollDeviceRequest request)
    {
        var user = await _authService.FindByCredentialsAsync(request.Email, request.Password);
        if (user == null || !DeviceService.IsRestrictedRole(user.Role))
            return Unauthorized(new { message = "Invalid email or password" });

        var isValid = await _otpService.VerifyAsync(user.Email, OtpChannels.Device, request.Code);
        if (!isValid)
            return BadRequest(new { message = "That code is invalid or has expired." });

        var result = await _authService.EnrollDeviceAndIssueSessionAsync(user, CurrentDeviceLabel, RawDeviceId);
        _logger.LogInformation("Staff device enrolled for user {UserId} ({Role}).", user.Id, user.Role);

        return Ok(IssueSession(result));
    }

    [HttpGet("staff/{userId}/devices")]
    [Authorize(Roles = UserRoles.Admin)]
    [DisableRateLimiting]
    public async Task<ActionResult<List<StaffDeviceResponse>>> GetStaffDevices(string userId)
    {
        var devices = await _deviceService.GetDevicesForUserAsync(userId);
        return Ok(devices
            .Select(d => new StaffDeviceResponse(d.Label, d.EnrolledVia, d.CreatedAt, d.LastSeenAt))
            .ToList());
    }

    /// <summary>Unbinds a staff member's device and ends their sessions - the recovery path for
    /// a lost or stolen phone. They re-enrol from their next device via email OTP.</summary>
    [HttpDelete("staff/{userId}/devices")]
    [Authorize(Roles = UserRoles.Admin)]
    public async Task<IActionResult> RevokeStaffDevice(string userId)
    {
        await _deviceService.RevokeAllDevicesForUserAsync(userId);
        _logger.LogInformation(
            "Admin {AdminId} revoked the bound device for user {UserId}.",
            User.FindFirstValue(ClaimTypes.NameIdentifier),
            userId);

        return NoContent();
    }
}
