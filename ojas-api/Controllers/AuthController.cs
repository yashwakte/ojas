using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.RateLimiting;
using OjasApi.Models;
using OjasApi.Services;

namespace OjasApi.Controllers;

[ApiController]
[Route("api/[controller]")]
[EnableRateLimiting("auth")]
public class AuthController : ControllerBase
{
    private readonly AuthService _authService;

    public AuthController(AuthService authService)
    {
        _authService = authService;
    }

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
        return Ok(result);
    }

    [HttpPost("login")]
    public async Task<ActionResult<AuthResponse>> Login([FromBody] LoginRequest request)
    {
        var result = await _authService.LoginAsync(request);
        if (result == null)
            return Unauthorized(new { message = "Invalid email or password" });
        return Ok(result);
    }
}
