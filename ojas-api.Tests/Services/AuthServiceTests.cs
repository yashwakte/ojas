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
    private readonly Mock<IMongoCollection<StaffDevice>> _staffDevicesMock = new();
    private readonly AuthService _sut;

    public AuthServiceTests()
    {
        _dbMock.Setup(d => d.Users).Returns(_usersMock.Object);
        _dbMock.Setup(d => d.RefreshTokens).Returns(_refreshTokensMock.Object);
        _dbMock.Setup(d => d.StaffDevices).Returns(_staffDevicesMock.Object);
        _staffDevicesMock.SetupFind(new List<StaffDevice>());
        _staffDevicesMock
            .Setup(c => c.InsertOneAsync(It.IsAny<StaffDevice>(), null, It.IsAny<CancellationToken>()))
            .Returns(Task.CompletedTask);

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

        _sut = new AuthService(_dbMock.Object, config, new DeviceService(_dbMock.Object));
    }

    private static User MakeUser(
        string email = "jane@example.com", string phone = "9123456789", string password = "Passw0rd!",
        string role = UserRoles.Customer, bool isEmailVerified = true, bool isPhoneVerified = true) => new()
    {
        Id = "507f1f77bcf86cd799439011",
        FullName = "Jane Doe",
        Email = email,
        Phone = phone,
        PasswordHash = BCrypt.Net.BCrypt.HashPassword(password),
        Role = role,
        IsEmailVerified = isEmailVerified,
        IsPhoneVerified = isPhoneVerified,
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

        var result = await _sut.LoginAsync(new LoginRequest(user.Email, "Passw0rd!", "test-turnstile-token"), null);

        result.Outcome.ShouldBe(LoginOutcome.Success);
        result.Auth.ShouldNotBeNull();
        result.Auth!.User.Email.ShouldBe(user.Email);
        result.Auth.Token.ShouldNotBeNullOrWhiteSpace();
    }

    [Fact]
    public async Task LoginAsync_ReturnsNull_WhenPasswordIsWrong()
    {
        var user = MakeUser(password: "Passw0rd!");
        _usersMock.SetupFind(new List<User> { user });

        var result = await _sut.LoginAsync(new LoginRequest(user.Email, "WrongPassword1!", "test-turnstile-token"), null);

        result.Outcome.ShouldBe(LoginOutcome.InvalidCredentials);
        result.Auth.ShouldBeNull();
    }

    [Fact]
    public async Task LoginAsync_ReturnsNull_WhenEmailIsUnknown()
    {
        _usersMock.SetupFind(new List<User>());

        var result = await _sut.LoginAsync(new LoginRequest("unknown@example.com", "Passw0rd!", "test-turnstile-token"), null);

        result.Outcome.ShouldBe(LoginOutcome.InvalidCredentials);
        result.Auth.ShouldBeNull();
    }

    [Fact]
    public async Task LoginAsync_DefaultsRoleToCustomer_WhenRoleIsBlank()
    {
        var user = MakeUser(password: "Passw0rd!", role: "");
        _usersMock.SetupFind(new List<User> { user });

        var result = await _sut.LoginAsync(new LoginRequest(user.Email, "Passw0rd!", "test-turnstile-token"), null);

        result.Outcome.ShouldBe(LoginOutcome.Success);
        result.Auth.ShouldNotBeNull();
        result.Auth!.User.Role.ShouldBe(UserRoles.Customer);
    }

    /// <summary>Registration proves the phone, not the address, so nearly every real customer
    /// account has an unverified email. Blocking on it would lock out the entire customer base.</summary>
    [Fact]
    public async Task LoginAsync_Succeeds_WhenTheEmailIsUnverified()
    {
        var user = MakeUser(password: "Passw0rd!", isEmailVerified: false);
        _usersMock.SetupFind(new List<User> { user });

        var result = await _sut.LoginAsync(new LoginRequest(user.Email, "Passw0rd!", "test-turnstile-token"), null);

        result.Outcome.ShouldBe(LoginOutcome.Success);
        result.Auth.ShouldNotBeNull();
    }

    /// <summary>The whole point of an identifier that can be either kind: an account whose
    /// email happens to have been registered as a phone-only lookalike must not exist for this
    /// to matter - what matters is that typing the phone number finds the account and password
    /// verification still gates it exactly as email-based login does.</summary>
    [Fact]
    public async Task LoginAsync_Succeeds_WhenTheIdentifierIsThePhoneNumberInstead()
    {
        var user = MakeUser(phone: "9123456789", password: "Passw0rd!");
        _usersMock.SetupFind(new List<User> { user });

        var result = await _sut.LoginAsync(new LoginRequest("9123456789", "Passw0rd!", "test-turnstile-token"), null);

        result.Outcome.ShouldBe(LoginOutcome.Success);
        result.Auth!.User.Email.ShouldBe(user.Email);
    }

    [Fact]
    public async Task LoginAsync_ReturnsTheAccountsRealEmail_NotTheTypedIdentifier_WhenUnverified()
    {
        // Login was attempted by phone number, but the follow-up flow needs the account's real
        // email to route the customer back into registration - echoing back the phone number
        // they typed would be useless there.
        var user = MakeUser(phone: "9123456789", isPhoneVerified: false);
        _usersMock.SetupFind(new List<User> { user });

        var result = await _sut.LoginAsync(new LoginRequest("9123456789", "Passw0rd!", "test-turnstile-token"), null);

        result.Outcome.ShouldBe(LoginOutcome.NeedsPhoneVerification);
        result.Email.ShouldBe(user.Email);
        result.Phone.ShouldBe(user.Phone);
    }

    [Fact]
    public async Task CreateStaffAsync_HappyPath_ForAdminRole_InsertsUser()
    {
        _usersMock.SetupFind(new List<User>());
        var request = new CreateStaffRequest("Staff Admin", "admin@example.com", "9123456789", "admin");

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
        var request = new CreateStaffRequest("Staff Delivery", "delivery@example.com", "9123456789", "delivery");

        var (staff, conflictField, error) = await _sut.CreateStaffAsync(request);

        error.ShouldBeNull();
        conflictField.ShouldBeNull();
        staff.ShouldNotBeNull();
        staff!.Role.ShouldBe(UserRoles.Delivery);
    }

    [Fact]
    public async Task CreateStaffAsync_ReturnsError_WhenRoleIsInvalid()
    {
        var request = new CreateStaffRequest("Someone", "someone@example.com", "9123456789", "superadmin");

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
        var request = new CreateStaffRequest("Staff Admin", "admin@example.com", "9123456789", "admin");

        var (staff, conflictField, error) = await _sut.CreateStaffAsync(request);

        staff.ShouldBeNull();
        error.ShouldBeNull();
        conflictField.ShouldBe("email");
    }

    [Fact]
    public async Task CompleteEmailVerificationAsync_IssuesASession_WhenPhoneWasAlreadyVerified()
    {
        var user = MakeUser(isEmailVerified: false, isPhoneVerified: true);
        _usersMock.SetupFind(new List<User> { user });

        var result = await _sut.CompleteEmailVerificationAsync(user.Email);

        result.ShouldNotBeNull();
        result!.EmailVerified.ShouldBeTrue();
        result.PhoneVerified.ShouldBeTrue();
        result.Session.ShouldNotBeNull();
        result.Session!.User.Email.ShouldBe(user.Email);
        result.Session.Token.ShouldNotBeNullOrWhiteSpace();
        _usersMock.Verify(c => c.UpdateOneAsync(
            It.IsAny<FilterDefinition<User>>(),
            It.IsAny<UpdateDefinition<User>>(),
            It.IsAny<UpdateOptions>(),
            It.IsAny<CancellationToken>()), Times.Once);
    }

    /// <summary>The two-step registration's whole point: verifying email alone must not be
    /// enough for a session while phone verification is still outstanding.</summary>
    [Fact]
    public async Task CompleteEmailVerificationAsync_WithholdsTheSession_WhenPhoneIsNotYetVerified()
    {
        var user = MakeUser(isEmailVerified: false, isPhoneVerified: false);
        _usersMock.SetupFind(new List<User> { user });

        var result = await _sut.CompleteEmailVerificationAsync(user.Email);

        result.ShouldNotBeNull();
        result!.EmailVerified.ShouldBeTrue();
        result.PhoneVerified.ShouldBeFalse();
        result.Session.ShouldBeNull();
    }

    [Fact]
    public async Task CompleteEmailVerificationAsync_ReturnsNull_WhenUserDoesNotExist()
    {
        _usersMock.SetupFind(new List<User>());

        var result = await _sut.CompleteEmailVerificationAsync("nobody@example.com");

        result.ShouldBeNull();
    }

    [Fact]
    public async Task CompletePhoneVerificationAsync_IssuesASession_WhenEmailWasAlreadyVerified()
    {
        var user = MakeUser(isEmailVerified: true, isPhoneVerified: false);
        _usersMock.SetupFind(new List<User> { user });

        var result = await _sut.CompletePhoneVerificationAsync(user.Phone);

        result.ShouldNotBeNull();
        result!.Session.ShouldNotBeNull();
        result.Session!.User.Phone.ShouldBe(user.Phone);
        // Not device-restricted - only staff sessions carry a bound device.
        result.Session.RawDeviceId.ShouldBeNull();
    }

    /// <summary>The phone is the only proof registration requires, so verifying it issues the
    /// session even though the address has never been confirmed.</summary>
    [Fact]
    public async Task CompletePhoneVerificationAsync_IssuesTheSession_EvenWithAnUnverifiedEmail()
    {
        var user = MakeUser(isEmailVerified: false, isPhoneVerified: false);
        _usersMock.SetupFind(new List<User> { user });

        var result = await _sut.CompletePhoneVerificationAsync(user.Phone);

        result.ShouldNotBeNull();
        result!.PhoneVerified.ShouldBeTrue();
        result.EmailVerified.ShouldBeFalse();
        result.Session.ShouldNotBeNull();
    }

    [Fact]
    public async Task CompletePhoneVerificationAsync_ReturnsNull_WhenNoUserHasThatNumber()
    {
        _usersMock.SetupFind(new List<User>());

        var result = await _sut.CompletePhoneVerificationAsync("9999999999");

        result.ShouldBeNull();
    }

    [Fact]
    public async Task RefreshAsync_ValidToken_RotatesAndReturnsNewSession()
    {
        var user = MakeUser();
        var token = new RefreshToken
        {
            TokenHash = "irrelevant",
            UserId = user.Id!,
            FamilyId = "family-1",
            ExpiresAt = DateTime.UtcNow.AddDays(10),
        };
        _usersMock.SetupFind(new List<User> { user });
        _refreshTokensMock.SetupFind(new List<RefreshToken> { token });
        _refreshTokensMock.SetupRotationClaim(token);

        var result = await _sut.RefreshAsync("some-raw-refresh-token", null);

        result.Outcome.ShouldBe(RefreshOutcome.Success);
        result.IsGraceReplay.ShouldBeFalse();
        result.Auth.ShouldNotBeNull();
        result.Auth!.User.Email.ShouldBe(user.Email);
        result.Auth.Token.ShouldNotBeNullOrWhiteSpace();
        result.Auth.RefreshToken.ShouldNotBeNullOrWhiteSpace();
        // The spent token is marked, not deleted - keeping it on file is the only way a later
        // replay of it can be told apart from an unknown token.
        _refreshTokensMock.Verify(c => c.DeleteOneAsync(
            It.IsAny<FilterDefinition<RefreshToken>>(), It.IsAny<CancellationToken>()), Times.Never);
        _refreshTokensMock.Verify(c => c.InsertOneAsync(
            It.IsAny<RefreshToken>(), null, It.IsAny<CancellationToken>()), Times.Once);
    }

    [Fact]
    public async Task RefreshAsync_RecentlyRotatedToken_RenewsAccessWithoutForkingTheFamily()
    {
        // Two tabs share one cookie jar, so when the access token expires they both refresh with
        // the same value. The loser of that race must not be signed out for it - but it must not
        // be handed its own refresh token either, or the session forks into two branches that
        // each rotate forever and never trip reuse detection. That fork is exactly what a token
        // thief would want, so the loser gets an access token and nothing else: the jar already
        // holds the successor the winner was issued.
        var user = MakeUser();
        _usersMock.SetupFind(new List<User> { user });
        _refreshTokensMock.SetupFind(new List<RefreshToken>
        {
            new()
            {
                TokenHash = "irrelevant",
                UserId = user.Id!,
                FamilyId = "family-1",
                RotatedAt = DateTime.UtcNow.AddSeconds(-2),
                ExpiresAt = DateTime.UtcNow.AddDays(7),
            },
        });
        // The conditional claim matches nothing, because the row is already stamped.
        _refreshTokensMock.SetupRotationClaim<RefreshToken>(null);

        var result = await _sut.RefreshAsync("just-rotated-token", null);

        result.Outcome.ShouldBe(RefreshOutcome.Success);
        result.IsGraceReplay.ShouldBeTrue();
        result.Auth.ShouldNotBeNull();
        result.Auth!.Token.ShouldNotBeNullOrWhiteSpace();
        result.Auth.RefreshToken.ShouldBeEmpty();
        _refreshTokensMock.Verify(c => c.InsertOneAsync(
            It.IsAny<RefreshToken>(), null, It.IsAny<CancellationToken>()), Times.Never);
    }

    [Fact]
    public async Task RefreshAsync_TwoSimultaneousCallers_OnlyTheClaimWinnerMintsASuccessor()
    {
        // Both tabs read the same unrotated row before either wrote to it, so the decision
        // cannot rest on that read - it rests on the conditional update, which exactly one of
        // them wins.
        var user = MakeUser();
        _usersMock.SetupFind(new List<User> { user });
        _refreshTokensMock.SetupFind(new List<RefreshToken>
        {
            new()
            {
                TokenHash = "irrelevant",
                UserId = user.Id!,
                FamilyId = "family-1",
                ExpiresAt = DateTime.UtcNow.AddDays(10),
            },
        });
        _refreshTokensMock.SetupRotationClaim<RefreshToken>(null);

        var result = await _sut.RefreshAsync("contended-token", null);

        result.Outcome.ShouldBe(RefreshOutcome.Success);
        result.IsGraceReplay.ShouldBeTrue();
        result.Auth!.RefreshToken.ShouldBeEmpty();
        _refreshTokensMock.Verify(c => c.InsertOneAsync(
            It.IsAny<RefreshToken>(), null, It.IsAny<CancellationToken>()), Times.Never);
    }

    [Fact]
    public async Task RefreshAsync_LongSpentToken_RevokesTheWholeFamily()
    {
        // Nobody's browser sits on a spent token for an hour and then tries it. Someone else has
        // a copy, and the owner can't be told apart from the thief - so the sign-in dies.
        var user = MakeUser();
        _usersMock.SetupFind(new List<User> { user });
        _refreshTokensMock.SetupFind(new List<RefreshToken>
        {
            new()
            {
                TokenHash = "irrelevant",
                UserId = user.Id!,
                FamilyId = "family-1",
                RotatedAt = DateTime.UtcNow.AddHours(-1),
                ExpiresAt = DateTime.UtcNow.AddDays(6),
            },
        });

        var result = await _sut.RefreshAsync("replayed-token", null);

        result.Outcome.ShouldBe(RefreshOutcome.ReuseDetected);
        result.Auth.ShouldBeNull();
        _refreshTokensMock.Verify(c => c.DeleteManyAsync(
            It.IsAny<FilterDefinition<RefreshToken>>(), It.IsAny<CancellationToken>()), Times.Once);
        _refreshTokensMock.Verify(c => c.InsertOneAsync(
            It.IsAny<RefreshToken>(), null, It.IsAny<CancellationToken>()), Times.Never);
    }

    [Fact]
    public async Task RefreshAsync_IsInvalid_WhenNoMatchingTokenExists()
    {
        _refreshTokensMock.SetupFind(new List<RefreshToken>());

        var result = await _sut.RefreshAsync("unknown-token", null);

        result.Outcome.ShouldBe(RefreshOutcome.Invalid);
        result.Auth.ShouldBeNull();
    }

    [Fact]
    public async Task RefreshAsync_IsInvalid_WhenTokenIsExpired()
    {
        var user = MakeUser();
        _usersMock.SetupFind(new List<User> { user });
        _refreshTokensMock.SetupFind(new List<RefreshToken>
        {
            new() { TokenHash = "irrelevant", UserId = user.Id!, ExpiresAt = DateTime.UtcNow.AddDays(-1) },
        });

        var result = await _sut.RefreshAsync("expired-token", null);

        result.Outcome.ShouldBe(RefreshOutcome.Invalid);
        result.Auth.ShouldBeNull();
    }

    [Fact]
    public async Task RevokeRefreshTokenAsync_DeletesTheWholeFamily_SoNoSiblingSurvivesLogout()
    {
        // Rotation's grace window can leave a sibling successor alive in another tab. Deleting
        // only the token that was handed in would leave that sibling minting access tokens
        // after the user pressed Log out.
        _refreshTokensMock.SetupFind(new List<RefreshToken>
        {
            new()
            {
                TokenHash = "irrelevant",
                UserId = "user-1",
                FamilyId = "family-1",
                ExpiresAt = DateTime.UtcNow.AddDays(10),
            },
        });

        await _sut.RevokeRefreshTokenAsync("some-token");

        _refreshTokensMock.Verify(c => c.DeleteManyAsync(
            It.IsAny<FilterDefinition<RefreshToken>>(), It.IsAny<CancellationToken>()), Times.Once);
    }

    [Fact]
    public async Task RevokeRefreshTokenAsync_StillDeletesByHash_WhenTheTokenIsUnknown()
    {
        _refreshTokensMock.SetupFind(new List<RefreshToken>());

        await _sut.RevokeRefreshTokenAsync("some-token");

        _refreshTokensMock.Verify(c => c.DeleteOneAsync(
            It.IsAny<FilterDefinition<RefreshToken>>(), It.IsAny<CancellationToken>()), Times.Once);
    }
}
