using Microsoft.Extensions.Configuration;
using Moq;
using MongoDB.Driver;
using OjasApi.Models;
using OjasApi.Services;
using OjasApi.Tests.TestHelpers;
using Shouldly;

namespace OjasApi.Tests.Services;

public class AuthServiceTests
{
    private readonly Mock<IMongoDbService> _dbMock = new();
    private readonly Mock<IMongoCollection<User>> _usersMock = new();
    private readonly Mock<IMongoCollection<RefreshToken>> _refreshTokensMock = new();
    private readonly AuthService _sut;

    public AuthServiceTests()
    {
        _dbMock.Setup(d => d.Users).Returns(_usersMock.Object);
        _dbMock.Setup(d => d.RefreshTokens).Returns(_refreshTokensMock.Object);

        // Mimics the real MongoDB driver's server-assigned ObjectId behaviour on insert, since
        // AuthService reads user.Id right back off the object immediately after InsertOneAsync
        // (e.g. to embed it in the JWT claims) and a bare Moq stub would leave it null.
        _usersMock
            .Setup(c => c.InsertOneAsync(It.IsAny<User>(), null, It.IsAny<CancellationToken>()))
            .Callback<User, InsertOneOptions?, CancellationToken>((user, _, _) => user.Id ??= "507f1f77bcf86cd799439099")
            .Returns(Task.CompletedTask);
        _refreshTokensMock
            .Setup(c => c.InsertOneAsync(It.IsAny<RefreshToken>(), null, It.IsAny<CancellationToken>()))
            .Returns(Task.CompletedTask);

        var config = new ConfigurationBuilder()
            .AddInMemoryCollection(new Dictionary<string, string?>
            {
                ["Jwt:Key"] = "test-signing-key-at-least-32-characters-long!!",
                ["Jwt:Issuer"] = "OjasApiTests",
                ["Jwt:Audience"] = "OjasApiTests",
            })
            .Build();

        _sut = new AuthService(_dbMock.Object, config);
    }

    private static User MakeUser(string email = "jane@example.com", string phone = "9123456789", string password = "Passw0rd!", string role = UserRoles.Customer, bool isEmailVerified = true) => new()
    {
        Id = "507f1f77bcf86cd799439011",
        FullName = "Jane Doe",
        Email = email,
        Phone = phone,
        PasswordHash = BCrypt.Net.BCrypt.HashPassword(password),
        Role = role,
        IsEmailVerified = isEmailVerified,
    };

    [Fact]
    public async Task EmailExistsAsync_ReturnsTrue_WhenAUserMatches()
    {
        _usersMock.SetupFind(new List<User> { MakeUser() });

        var result = await _sut.EmailExistsAsync("jane@example.com");

        result.ShouldBeTrue();
    }

    [Fact]
    public async Task EmailExistsAsync_ReturnsFalse_WhenNoUserMatches()
    {
        _usersMock.SetupFind(new List<User>());

        var result = await _sut.EmailExistsAsync("nobody@example.com");

        result.ShouldBeFalse();
    }

    [Fact]
    public async Task PhoneExistsAsync_ReturnsTrue_WhenAUserMatches()
    {
        _usersMock.SetupFind(new List<User> { MakeUser() });

        var result = await _sut.PhoneExistsAsync("9123456789");

        result.ShouldBeTrue();
    }

    [Fact]
    public async Task PhoneExistsAsync_ReturnsFalse_WhenNoUserMatches()
    {
        _usersMock.SetupFind(new List<User>());

        var result = await _sut.PhoneExistsAsync("9000000000");

        result.ShouldBeFalse();
    }

    [Fact]
    public async Task RegisterAsync_HappyPath_InsertsUnverifiedUser()
    {
        _usersMock.SetupFind(new List<User>());
        var request = new RegisterRequest("New User", "new@example.com", "9123456789", "Passw0rd!", "test-turnstile-token");

        var (result, conflictField) = await _sut.RegisterAsync(request);

        conflictField.ShouldBeNull();
        result.ShouldNotBeNull();
        result!.Email.ShouldBe("new@example.com");
        result.Role.ShouldBe(UserRoles.Customer);
        result.IsEmailVerified.ShouldBeFalse();
        _usersMock.Verify(c => c.InsertOneAsync(It.IsAny<User>(), null, It.IsAny<CancellationToken>()), Times.Once);
    }

    [Fact]
    public async Task RegisterAsync_ReturnsEmailConflict_WhenEmailAlreadyExists()
    {
        _usersMock.SetupFind(new List<User> { MakeUser(email: "new@example.com") });
        var request = new RegisterRequest("New User", "new@example.com", "9123456789", "Passw0rd!", "test-turnstile-token");

        var (result, conflictField) = await _sut.RegisterAsync(request);

        result.ShouldBeNull();
        conflictField.ShouldBe("email");
        _usersMock.Verify(c => c.InsertOneAsync(It.IsAny<User>(), null, It.IsAny<CancellationToken>()), Times.Never);
    }

    [Fact]
    public async Task RegisterAsync_ReturnsPhoneConflict_WhenPhoneAlreadyExists()
    {
        // RegisterAsync checks email first, then phone. SetupFind can't discriminate by filter (every
        // Find(...) call returns the same data), so to exercise the phone-only-conflict branch we
        // sequence FindAsync directly: first call (email lookup) returns no match, second call (phone
        // lookup) returns a match.
        var emptyCursor = new List<User>().ToMockCursor();
        var matchCursor = new List<User> { MakeUser(phone: "9123456789") }.ToMockCursor();
        _usersMock
            .SetupSequence(c => c.FindAsync(
                It.IsAny<FilterDefinition<User>>(),
                It.IsAny<FindOptions<User, User>>(),
                It.IsAny<CancellationToken>()))
            .ReturnsAsync(emptyCursor.Object)
            .ReturnsAsync(matchCursor.Object);

        var request = new RegisterRequest("New User", "different@example.com", "9123456789", "Passw0rd!", "test-turnstile-token");

        var (result, conflictField) = await _sut.RegisterAsync(request);

        result.ShouldBeNull();
        conflictField.ShouldBe("phone");
        _usersMock.Verify(c => c.InsertOneAsync(It.IsAny<User>(), null, It.IsAny<CancellationToken>()), Times.Never);
    }

    [Fact]
    public async Task LoginAsync_ReturnsToken_WhenCredentialsAreValid()
    {
        var user = MakeUser(password: "Passw0rd!");
        _usersMock.SetupFind(new List<User> { user });

        var (result, needsEmailVerification) = await _sut.LoginAsync(new LoginRequest(user.Email, "Passw0rd!", "test-turnstile-token"));

        needsEmailVerification.ShouldBeFalse();
        result.ShouldNotBeNull();
        result!.User.Email.ShouldBe(user.Email);
        result.Token.ShouldNotBeNullOrWhiteSpace();
    }

    [Fact]
    public async Task LoginAsync_ReturnsNull_WhenPasswordIsWrong()
    {
        var user = MakeUser(password: "Passw0rd!");
        _usersMock.SetupFind(new List<User> { user });

        var (result, needsEmailVerification) = await _sut.LoginAsync(new LoginRequest(user.Email, "WrongPassword1!", "test-turnstile-token"));

        result.ShouldBeNull();
        needsEmailVerification.ShouldBeFalse();
    }

    [Fact]
    public async Task LoginAsync_ReturnsNull_WhenEmailIsUnknown()
    {
        _usersMock.SetupFind(new List<User>());

        var (result, needsEmailVerification) = await _sut.LoginAsync(new LoginRequest("unknown@example.com", "Passw0rd!", "test-turnstile-token"));

        result.ShouldBeNull();
        needsEmailVerification.ShouldBeFalse();
    }

    [Fact]
    public async Task LoginAsync_DefaultsRoleToCustomer_WhenRoleIsBlank()
    {
        var user = MakeUser(password: "Passw0rd!", role: "");
        _usersMock.SetupFind(new List<User> { user });

        var (result, needsEmailVerification) = await _sut.LoginAsync(new LoginRequest(user.Email, "Passw0rd!", "test-turnstile-token"));

        needsEmailVerification.ShouldBeFalse();
        result.ShouldNotBeNull();
        result!.User.Role.ShouldBe(UserRoles.Customer);
    }

    [Fact]
    public async Task LoginAsync_ReturnsNeedsEmailVerification_WhenAccountIsUnverified()
    {
        var user = MakeUser(password: "Passw0rd!", isEmailVerified: false);
        _usersMock.SetupFind(new List<User> { user });

        var (result, needsEmailVerification) = await _sut.LoginAsync(new LoginRequest(user.Email, "Passw0rd!", "test-turnstile-token"));

        result.ShouldBeNull();
        needsEmailVerification.ShouldBeTrue();
    }

    [Fact]
    public async Task CreateStaffAsync_HappyPath_ForAdminRole_InsertsUser()
    {
        _usersMock.SetupFind(new List<User>());
        var request = new CreateStaffRequest("Staff Admin", "admin@example.com", "9123456789", "Passw0rd!", "admin");

        var (staff, conflictField, error) = await _sut.CreateStaffAsync(request);

        error.ShouldBeNull();
        conflictField.ShouldBeNull();
        staff.ShouldNotBeNull();
        staff!.Role.ShouldBe(UserRoles.Admin);
        _usersMock.Verify(c => c.InsertOneAsync(It.IsAny<User>(), null, It.IsAny<CancellationToken>()), Times.Once);
    }

    [Fact]
    public async Task CreateStaffAsync_HappyPath_ForDeliveryRole_InsertsUser()
    {
        _usersMock.SetupFind(new List<User>());
        var request = new CreateStaffRequest("Staff Delivery", "delivery@example.com", "9123456789", "Passw0rd!", "delivery");

        var (staff, conflictField, error) = await _sut.CreateStaffAsync(request);

        error.ShouldBeNull();
        conflictField.ShouldBeNull();
        staff.ShouldNotBeNull();
        staff!.Role.ShouldBe(UserRoles.Delivery);
    }

    [Fact]
    public async Task CreateStaffAsync_ReturnsError_WhenRoleIsInvalid()
    {
        var request = new CreateStaffRequest("Someone", "someone@example.com", "9123456789", "Passw0rd!", "superadmin");

        var (staff, conflictField, error) = await _sut.CreateStaffAsync(request);

        staff.ShouldBeNull();
        conflictField.ShouldBeNull();
        error.ShouldNotBeNullOrWhiteSpace();
        _usersMock.Verify(c => c.InsertOneAsync(It.IsAny<User>(), null, It.IsAny<CancellationToken>()), Times.Never);
    }

    [Fact]
    public async Task CreateStaffAsync_ReturnsEmailConflict_WhenEmailExists()
    {
        _usersMock.SetupFind(new List<User> { MakeUser(email: "admin@example.com") });
        var request = new CreateStaffRequest("Staff Admin", "admin@example.com", "9123456789", "Passw0rd!", "admin");

        var (staff, conflictField, error) = await _sut.CreateStaffAsync(request);

        staff.ShouldBeNull();
        error.ShouldBeNull();
        conflictField.ShouldBe("email");
    }

    [Fact]
    public async Task CompleteEmailVerificationAsync_MarksVerifiedAndReturnsToken()
    {
        var user = MakeUser(isEmailVerified: false);
        _usersMock.SetupFind(new List<User> { user });

        var result = await _sut.CompleteEmailVerificationAsync(user.Email);

        result.ShouldNotBeNull();
        result!.User.Email.ShouldBe(user.Email);
        result.Token.ShouldNotBeNullOrWhiteSpace();
        _usersMock.Verify(c => c.UpdateOneAsync(
            It.IsAny<FilterDefinition<User>>(),
            It.IsAny<UpdateDefinition<User>>(),
            It.IsAny<UpdateOptions>(),
            It.IsAny<CancellationToken>()), Times.Once);
    }

    [Fact]
    public async Task CompleteEmailVerificationAsync_ReturnsNull_WhenUserDoesNotExist()
    {
        _usersMock.SetupFind(new List<User>());

        var result = await _sut.CompleteEmailVerificationAsync("nobody@example.com");

        result.ShouldBeNull();
    }

    [Fact]
    public async Task RefreshAsync_ValidToken_RotatesAndReturnsNewSession()
    {
        var user = MakeUser();
        _usersMock.SetupFind(new List<User> { user });
        _refreshTokensMock.SetupFind(new List<RefreshToken>
        {
            new() { TokenHash = "irrelevant", UserId = user.Id!, ExpiresAt = DateTime.UtcNow.AddDays(10) },
        });

        var result = await _sut.RefreshAsync("some-raw-refresh-token");

        result.ShouldNotBeNull();
        result!.User.Email.ShouldBe(user.Email);
        result.Token.ShouldNotBeNullOrWhiteSpace();
        result.RefreshToken.ShouldNotBeNullOrWhiteSpace();
        _refreshTokensMock.Verify(c => c.DeleteOneAsync(
            It.IsAny<FilterDefinition<RefreshToken>>(), It.IsAny<CancellationToken>()), Times.Once);
        _refreshTokensMock.Verify(c => c.InsertOneAsync(
            It.IsAny<RefreshToken>(), null, It.IsAny<CancellationToken>()), Times.Once);
    }

    [Fact]
    public async Task RefreshAsync_ReturnsNull_WhenNoMatchingTokenExists()
    {
        _refreshTokensMock.SetupFind(new List<RefreshToken>());

        var result = await _sut.RefreshAsync("unknown-token");

        result.ShouldBeNull();
    }

    [Fact]
    public async Task RefreshAsync_ReturnsNull_WhenTokenIsExpired()
    {
        var user = MakeUser();
        _usersMock.SetupFind(new List<User> { user });
        _refreshTokensMock.SetupFind(new List<RefreshToken>
        {
            new() { TokenHash = "irrelevant", UserId = user.Id!, ExpiresAt = DateTime.UtcNow.AddDays(-1) },
        });

        var result = await _sut.RefreshAsync("expired-token");

        result.ShouldBeNull();
    }

    [Fact]
    public async Task RevokeRefreshTokenAsync_DeletesMatchingToken()
    {
        await _sut.RevokeRefreshTokenAsync("some-token");

        _refreshTokensMock.Verify(c => c.DeleteOneAsync(
            It.IsAny<FilterDefinition<RefreshToken>>(), It.IsAny<CancellationToken>()), Times.Once);
    }
}
