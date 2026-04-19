using System.IdentityModel.Tokens.Jwt;
using System.Security.Claims;
using System.Text;
using Microsoft.IdentityModel.Tokens;
using MongoDB.Driver;
using OjasApi.Models;

namespace OjasApi.Services;

public class AuthService
{
    private readonly MongoDbService _db;
    private readonly IConfiguration _config;

    public AuthService(MongoDbService db, IConfiguration config)
    {
        _db = db;
        _config = config;
    }

    public async Task<bool> EmailExistsAsync(string email) =>
        await _db.Users.Find(u => u.Email == email).AnyAsync();

    public async Task<bool> PhoneExistsAsync(string phone) =>
        await _db.Users.Find(u => u.Phone == phone).AnyAsync();

    public async Task<(AuthResponse? Response, string? ConflictField)> RegisterAsync(RegisterRequest request)
    {
        var byEmail = await _db.Users
            .Find(u => u.Email == request.Email)
            .FirstOrDefaultAsync();
        if (byEmail != null)
            return (null, "email");

        var byPhone = await _db.Users
            .Find(u => u.Phone == request.Phone)
            .FirstOrDefaultAsync();
        if (byPhone != null)
            return (null, "phone");

        var user = new User
        {
            FullName = request.FullName,
            Email = request.Email,
            Phone = request.Phone,
            PasswordHash = BCrypt.Net.BCrypt.HashPassword(request.Password)
        };

        await _db.Users.InsertOneAsync(user);
        var token = GenerateToken(user);
        return (new AuthResponse(token, user.FullName, user.Email, user.Phone), null);
    }

    public async Task<AuthResponse?> LoginAsync(LoginRequest request)
    {
        var user = await _db.Users
            .Find(u => u.Email == request.Email)
            .FirstOrDefaultAsync();

        if (user == null || !BCrypt.Net.BCrypt.Verify(request.Password, user.PasswordHash))
            return null;

        var token = GenerateToken(user);
        return new AuthResponse(token, user.FullName, user.Email, user.Phone);
    }

    private string GenerateToken(User user)
    {
        var key = new SymmetricSecurityKey(
            Encoding.UTF8.GetBytes(_config["Jwt:Key"]!));
        var credentials = new SigningCredentials(key, SecurityAlgorithms.HmacSha256);

        var claims = new[]
        {
            new Claim(ClaimTypes.NameIdentifier, user.Id!),
            new Claim(ClaimTypes.Email, user.Email),
            new Claim(ClaimTypes.Name, user.FullName),
            new Claim("phone", user.Phone),
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
