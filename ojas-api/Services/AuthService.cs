using System.IdentityModel.Tokens.Jwt;
using System.Security.Claims;
using System.Text;
using Microsoft.IdentityModel.Tokens;
using MongoDB.Driver;
using OjasApi.Models;

namespace OjasApi.Services;

public class AuthService
{
    private readonly IMongoDbService _db;
    private readonly IConfiguration _config;

    public AuthService(IMongoDbService db, IConfiguration config)
    {
        _db = db;
        _config = config;
    }

    private static string NormalizeEmail(string email) => email.Trim().ToLowerInvariant();
    private static string NormalizePhone(string phone) => phone.Trim();

    public async Task<bool> EmailExistsAsync(string email) =>
        await _db.Users.Find(u => u.Email == NormalizeEmail(email)).AnyAsync();

    public async Task<bool> PhoneExistsAsync(string phone) =>
        await _db.Users.Find(u => u.Phone == NormalizePhone(phone)).AnyAsync();

    public async Task<(AuthResult? Result, string? ConflictField)> RegisterAsync(RegisterRequest request)
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
        var token = GenerateToken(user);
        return (new AuthResult(token, new AuthResponse(user.Id!, user.FullName, user.Email, user.Phone, user.Role)), null);
    }

    public async Task<AuthResult?> LoginAsync(LoginRequest request)
    {
        var normalizedEmail = NormalizeEmail(request.Email);

        var user = await _db.Users
            .Find(u => u.Email == normalizedEmail)
            .FirstOrDefaultAsync();

        if (user == null || !BCrypt.Net.BCrypt.Verify(request.Password, user.PasswordHash))
            return null;

        if (string.IsNullOrWhiteSpace(user.Role))
            user.Role = UserRoles.Customer;

        var token = GenerateToken(user);
        return new AuthResult(token, new AuthResponse(user.Id!, user.FullName, user.Email, user.Phone, user.Role));
    }

    public async Task<(StaffUserResponse? Staff, string? ConflictField, string? Error)> CreateStaffAsync(CreateStaffRequest request)
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
            PasswordHash = BCrypt.Net.BCrypt.HashPassword(request.Password),
            Role = normalizedRole,
            IsEmailVerified = true,
            IsPhoneVerified = true
        };

        await _db.Users.InsertOneAsync(user);
        return (
            new StaffUserResponse(user.Id!, user.FullName, user.Email, user.Phone, user.Role),
            null,
            null
        );
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
            expires: DateTime.UtcNow.AddHours(2),
            signingCredentials: credentials
        );

        return new JwtSecurityTokenHandler().WriteToken(token);
    }
}
