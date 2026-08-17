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

        var token = GenerateToken(user);
        return new AuthResult(token, new AuthResponse(user.Id!, user.FullName, user.Email, user.Phone, user.Role));
    }

    public async Task<(AuthResult? Result, bool NeedsEmailVerification)> LoginAsync(LoginRequest request)
    {
        var normalizedEmail = NormalizeEmail(request.Email);

        var user = await _db.Users
            .Find(u => u.Email == normalizedEmail)
            .FirstOrDefaultAsync();

        if (user == null || !BCrypt.Net.BCrypt.Verify(request.Password, user.PasswordHash))
            return (null, false);

        if (!user.IsEmailVerified)
            return (null, true);

        if (string.IsNullOrWhiteSpace(user.Role))
            user.Role = UserRoles.Customer;

        var token = GenerateToken(user);
        return (new AuthResult(token, new AuthResponse(user.Id!, user.FullName, user.Email, user.Phone, user.Role)), false);
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

    public async Task MarkPhoneVerifiedAsync(string userId)
    {
        await _db.Users.UpdateOneAsync(
            Builders<User>.Filter.Eq(u => u.Id, userId),
            Builders<User>.Update.Set(u => u.IsPhoneVerified, true));
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

    // Lets the very first admin account be created through the API instead of a manual
    // Atlas edit. Self-disables the moment any admin exists, so it can't be used as a
    // standing backdoor once the team has a real admin account.
    public async Task<(AuthResult? Result, string? ConflictField, string? Error)> BootstrapAdminAsync(RegisterRequest request)
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
        var token = GenerateToken(user);
        return (new AuthResult(token, new AuthResponse(user.Id!, user.FullName, user.Email, user.Phone, user.Role)), null, null);
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
