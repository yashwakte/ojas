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
    private readonly IWebHostEnvironment _env;

    public AuthController(AuthService authService, IWebHostEnvironment env)
    {
        _authService = authService;
        _env = env;
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

    [HttpGet("ping")]
    [DisableRateLimiting]
    public IActionResult Ping() => Ok("pong");

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

    [HttpPost("register")]
    public async Task<ActionResult<AuthResponse>> Register([FromBody] RegisterRequest request)
    {
        var (result, conflictField) = await _authService.RegisterAsync(request);
        if (result == null)
        {
            var message = conflictField == "email"
                ? "Email already registered"
                : "Phone number already in use";
            return Conflict(new { message, field = conflictField });
        }

        var csrfToken = Convert.ToHexString(System.Security.Cryptography.RandomNumberGenerator.GetBytes(32));
        Response.Cookies.Append(AuthCookieName, result!.Token, BuildAuthCookieOptions());
        Response.Cookies.Append(CsrfCookieName, csrfToken, BuildCsrfCookieOptions());
        return Ok(result.User with { CsrfToken = csrfToken });
    }

    [HttpPost("login")]
    public async Task<ActionResult<AuthResponse>> Login([FromBody] LoginRequest request)
    {
        var result = await _authService.LoginAsync(request);
        if (result == null)
            return Unauthorized(new { message = "Invalid email or password" });

        var csrfToken = Convert.ToHexString(System.Security.Cryptography.RandomNumberGenerator.GetBytes(32));
        Response.Cookies.Append(AuthCookieName, result.Token, BuildAuthCookieOptions());
        Response.Cookies.Append(CsrfCookieName, csrfToken, BuildCsrfCookieOptions());
        return Ok(result.User with { CsrfToken = csrfToken });
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
