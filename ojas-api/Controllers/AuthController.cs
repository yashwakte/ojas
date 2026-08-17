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
    private readonly AuthService _authService;
    private readonly OtpService _otpService;
    private readonly IWebHostEnvironment _env;
    private readonly ILogger<AuthController> _logger;

    public AuthController(AuthService authService, OtpService otpService, IWebHostEnvironment env, ILogger<AuthController> logger)
    {
        _authService = authService;
        _otpService = otpService;
        _env = env;
        _logger = logger;
    }

    private CookieOptions BuildAuthCookieOptions() => new()
    {
        HttpOnly = true,
        Secure = true,
        SameSite = SameSiteMode.None,
        Path = "/",
        Expires = DateTimeOffset.UtcNow.AddHours(2)
    };

    private CookieOptions BuildCsrfCookieOptions() => new()
    {
        HttpOnly = false,
        Secure = true,
        SameSite = SameSiteMode.None,
        Path = "/",
        Expires = DateTimeOffset.UtcNow.AddHours(2)
    };

    /// <summary>Sets the auth+CSRF cookies for a verified session and returns the response body
    /// every login-equivalent endpoint (login, register-verify, bootstrap-admin) shares.</summary>
    private AuthResponse IssueSession(AuthResult result)
    {
        var csrfToken = Convert.ToHexString(System.Security.Cryptography.RandomNumberGenerator.GetBytes(32));
        Response.Cookies.Append(AuthCookieName, result.Token, BuildAuthCookieOptions());
        Response.Cookies.Append(CsrfCookieName, csrfToken, BuildCsrfCookieOptions());
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
        var (result, needsEmailVerification) = await _authService.LoginAsync(request);
        if (needsEmailVerification)
        {
            return StatusCode(StatusCodes.Status403Forbidden, new
            {
                message = "Please verify your email before signing in.",
                needsEmailVerification = true,
                email = request.Email,
            });
        }

        if (result == null)
            return Unauthorized(new { message = "Invalid email or password" });

        return Ok(IssueSession(result));
    }

    [HttpPost("logout")]
    [DisableRateLimiting]
    public IActionResult Logout()
    {
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
        return NoContent();
    }

    // One-time bootstrap for the first admin account. Works only while the Users
    // collection has zero admins; every call after that returns 409, so this can be
    // left in the deployed API without acting as a standing backdoor.
    [HttpPost("bootstrap-admin")]
    public async Task<ActionResult<AuthResponse>> BootstrapAdmin([FromBody] RegisterRequest request)
    {
        var (result, conflictField, error) = await _authService.BootstrapAdminAsync(request);
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

}
