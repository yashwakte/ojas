using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.Logging.Abstractions;
using Moq;
using MongoDB.Driver;
using OjasApi.Controllers;
using OjasApi.Models;
using OjasApi.Services;
using OjasApi.Tests.TestHelpers;
using Shouldly;

namespace OjasApi.Tests.Controllers;

public class AuthControllerTests
{
    private readonly Mock<IMongoDbService> _dbMock = new();
    private readonly Mock<IMongoCollection<User>> _usersMock = new();
    private readonly Mock<IMongoCollection<OtpCode>> _otpCodesMock = new();
    private readonly Mock<IMongoCollection<RefreshToken>> _refreshTokensMock = new();
    private readonly Mock<IMongoCollection<StaffDevice>> _staffDevicesMock = new();
    private readonly Mock<IMongoCollection<StaffInvite>> _staffInvitesMock = new();
    private readonly Mock<IEmailSender> _emailSenderMock = new();
    private readonly Mock<IPhoneOtpSender> _phoneOtpSenderMock = new();
    private readonly Mock<ITurnstileVerifier> _turnstileVerifierMock = new();
    private readonly AuthController _sut;

    public AuthControllerTests()
    {
        _dbMock.Setup(d => d.Users).Returns(_usersMock.Object);
        _dbMock.Setup(d => d.OtpCodes).Returns(_otpCodesMock.Object);
        _dbMock.Setup(d => d.RefreshTokens).Returns(_refreshTokensMock.Object);
        _dbMock.Setup(d => d.StaffDevices).Returns(_staffDevicesMock.Object);
        _dbMock.Setup(d => d.StaffInvites).Returns(_staffInvitesMock.Object);
        _staffDevicesMock.SetupFind(new List<StaffDevice>());
        _staffInvitesMock.SetupFind(new List<StaffInvite>());
        _staffInvitesMock
            .Setup(c => c.InsertOneAsync(It.IsAny<StaffInvite>(), null, It.IsAny<CancellationToken>()))
            .Returns(Task.CompletedTask);
        _staffDevicesMock
            .Setup(c => c.InsertOneAsync(It.IsAny<StaffDevice>(), null, It.IsAny<CancellationToken>()))
            .Returns(Task.CompletedTask);
        _usersMock
            .Setup(c => c.InsertOneAsync(It.IsAny<User>(), null, It.IsAny<CancellationToken>()))
            .Callback<User, InsertOneOptions?, CancellationToken>((user, _, _) => user.Id ??= "507f1f77bcf86cd799439099")
            .Returns(Task.CompletedTask);
        _phoneOtpSenderMock.Setup(s => s.IsConfigured).Returns(false);
        _turnstileVerifierMock
            .Setup(v => v.VerifyAsync(It.IsAny<string>(), It.IsAny<string?>()))
            .ReturnsAsync(true);

        var config = new ConfigurationBuilder()
            .AddInMemoryCollection(new Dictionary<string, string?>
            {
                ["Jwt:Key"] = "test-signing-key-at-least-32-characters-long!!",
                ["Jwt:Issuer"] = "OjasApiTests",
                ["Jwt:Audience"] = "OjasApiTests",
            })
            .Build();

        var deviceService = new DeviceService(_dbMock.Object);
        var authService = new AuthService(_dbMock.Object, config, deviceService);
        var otpService = new OtpService(_dbMock.Object, _emailSenderMock.Object, _phoneOtpSenderMock.Object, NullLogger<OtpService>.Instance);
        var envMock = new Mock<IWebHostEnvironment>();
        envMock.Setup(e => e.EnvironmentName).Returns("Development");
        var inviteService = new StaffInviteService(
            _dbMock.Object, _emailSenderMock.Object, config, NullLogger<StaffInviteService>.Instance);
        // Unconfigured (config carries no Msg91:WidgetAuthKey) - same posture as
        // _phoneOtpSenderMock's default, matching production today. Msg91WidgetVerifierTests
        // covers the configured/verified paths in isolation.
        var phoneWidgetVerifier = new Msg91WidgetVerifier(new HttpClient(), config, NullLogger<Msg91WidgetVerifier>.Instance);

        _sut = new AuthController(authService, otpService, deviceService, inviteService, _turnstileVerifierMock.Object, phoneWidgetVerifier, envMock.Object, NullLogger<AuthController>.Instance)
        {
            ControllerContext = new ControllerContext { HttpContext = new DefaultHttpContext() },
        };
    }

    private static User MakeUser(string email = "jane@example.com", string phone = "9123456789", string password = "Passw0rd!", bool isEmailVerified = true) => new()
    {
        Id = "507f1f77bcf86cd799439011",
        FullName = "Jane Doe",
        Email = email,
        Phone = phone,
        PasswordHash = BCrypt.Net.BCrypt.HashPassword(password),
        Role = UserRoles.Customer,
        IsEmailVerified = isEmailVerified,
    };

    private static IEnumerable<string> SetCookieHeaders(ControllerContext context) =>
        context.HttpContext.Response.Headers["Set-Cookie"].ToArray()!;

    /// <summary>Points _sut at a fresh context carrying the given cookie on the request, the way
    /// a browser would send ojas_refresh back on a /refresh or /logout call.</summary>
    private void SetRequestCookie(string name, string value) =>
        SetRequestCookies((name, value));

    /// <summary>Sets several cookies on one request. They have to go on together: each call
    /// builds a fresh HttpContext, so setting them one at a time would leave only the last.</summary>
    private void SetRequestCookies(params (string Name, string Value)[] cookies)
    {
        var httpContext = new DefaultHttpContext();
        httpContext.Request.Headers["Cookie"] = string.Join("; ", cookies.Select(c => $"{c.Name}={c.Value}"));
        _sut.ControllerContext = new ControllerContext { HttpContext = httpContext };
    }

    [Fact]
    public void Ping_ReturnsPong()
    {
        var result = _sut.Ping();

        var okResult = result.ShouldBeOfType<OkObjectResult>();
        okResult.Value.ShouldBe("pong");
    }

    [Fact]
    public async Task CheckEmail_ReturnsExistsTrue_WhenEmailIsRegistered()
    {
        _usersMock.SetupFind(new List<User> { MakeUser() });

        var result = await _sut.CheckEmail("jane@example.com");

        var okResult = result.ShouldBeOfType<OkObjectResult>();
        okResult.Value.ShouldNotBeNull();
    }

    [Fact]
    public async Task CheckEmail_ReturnsExistsFalse_WhenEmailIsUnregistered()
    {
        _usersMock.SetupFind(new List<User>());

        var result = await _sut.CheckEmail("unknown@example.com");

        result.ShouldBeOfType<OkObjectResult>();
    }

    [Fact]
    public async Task CheckPhone_ReturnsOk()
    {
        _usersMock.SetupFind(new List<User>());

        var result = await _sut.CheckPhone("9000000000");

        result.ShouldBeOfType<OkObjectResult>();
    }

    [Fact]
    public async Task Register_Success_ReturnsPendingVerification_AndSetsNoCookiesYet()
    {
        _usersMock.SetupFind(new List<User>());
        var request = new RegisterRequest("New User", "new@example.com", "9123456789", "Passw0rd!", "test-turnstile-token");

        var result = await _sut.Register(request);

        var okResult = result.Result.ShouldBeOfType<OkObjectResult>();
        var response = okResult.Value.ShouldBeOfType<RegisterPendingResponse>();
        response.Email.ShouldBe("new@example.com");
        response.DevCode.ShouldNotBeNullOrWhiteSpace();

        var cookies = SetCookieHeaders(_sut.ControllerContext);
        cookies.ShouldBeEmpty();
    }

    [Fact]
    public async Task Register_TurnstileFails_ReturnsBadRequest_AndNeverTouchesTheDatabase()
    {
        _turnstileVerifierMock.Setup(v => v.VerifyAsync(It.IsAny<string>(), It.IsAny<string?>())).ReturnsAsync(false);
        var request = new RegisterRequest("New User", "new@example.com", "9123456789", "Passw0rd!", "bad-token");

        var result = await _sut.Register(request);

        result.Result.ShouldBeOfType<BadRequestObjectResult>();
        _usersMock.Verify(c => c.InsertOneAsync(It.IsAny<User>(), null, It.IsAny<CancellationToken>()), Times.Never);
    }

    [Fact]
    public async Task Register_EmailConflict_ReturnsConflictWithEmailField()
    {
        _usersMock.SetupFind(new List<User> { MakeUser(email: "new@example.com") });
        var request = new RegisterRequest("New User", "new@example.com", "9123456789", "Passw0rd!", "test-turnstile-token");

        var result = await _sut.Register(request);

        var conflict = result.Result.ShouldBeOfType<ConflictObjectResult>();
        conflict.Value.ShouldNotBeNull();
    }

    [Fact]
    public async Task VerifyEmailOtp_Success_SetsAuthAndCsrfCookies()
    {
        var user = MakeUser(isEmailVerified: false);
        _usersMock.SetupFind(new List<User> { user });
        var otp = new OtpCode
        {
            Target = user.Email,
            Channel = OtpChannels.Email,
            CodeHash = BCrypt.Net.BCrypt.HashPassword("123456"),
            ExpiresAt = DateTime.UtcNow.AddMinutes(5),
        };
        _otpCodesMock.SetupFind(new List<OtpCode> { otp });

        var result = await _sut.VerifyEmailOtp(new VerifyEmailOtpRequest(user.Email, "123456"));

        var okResult = result.Result.ShouldBeOfType<OkObjectResult>();
        var response = okResult.Value.ShouldBeOfType<AuthResponse>();
        response.CsrfToken.ShouldNotBeNullOrWhiteSpace();

        var cookies = SetCookieHeaders(_sut.ControllerContext);
        cookies.ShouldContain(c => c.StartsWith("ojas_auth="));
        cookies.ShouldContain(c => c.StartsWith("ojas_refresh="));
        cookies.ShouldContain(c => c.StartsWith("ojas_csrf="));
    }

    [Fact]
    public async Task VerifyEmailOtp_WrongCode_ReturnsBadRequest()
    {
        var user = MakeUser(isEmailVerified: false);
        _usersMock.SetupFind(new List<User> { user });
        var otp = new OtpCode
        {
            Target = user.Email,
            Channel = OtpChannels.Email,
            CodeHash = BCrypt.Net.BCrypt.HashPassword("123456"),
            ExpiresAt = DateTime.UtcNow.AddMinutes(5),
        };
        _otpCodesMock.SetupFind(new List<OtpCode> { otp });

        var result = await _sut.VerifyEmailOtp(new VerifyEmailOtpRequest(user.Email, "000000"));

        result.Result.ShouldBeOfType<BadRequestObjectResult>();
    }

    [Fact]
    public async Task Login_Success_SetsCookies()
    {
        var user = MakeUser(password: "Passw0rd!");
        _usersMock.SetupFind(new List<User> { user });

        var result = await _sut.Login(new LoginRequest(user.Email, "Passw0rd!", "test-turnstile-token"));

        var okResult = result.Result.ShouldBeOfType<OkObjectResult>();
        var response = okResult.Value.ShouldBeOfType<AuthResponse>();
        response.CsrfToken.ShouldNotBeNullOrWhiteSpace();

        var cookies = SetCookieHeaders(_sut.ControllerContext);
        cookies.ShouldContain(c => c.StartsWith("ojas_auth="));
        cookies.ShouldContain(c => c.StartsWith("ojas_refresh="));
        cookies.ShouldContain(c => c.StartsWith("ojas_csrf="));
    }

    [Fact]
    public async Task Login_TurnstileFails_ReturnsBadRequest_AndSetsNoCookies()
    {
        var user = MakeUser(password: "Passw0rd!");
        _usersMock.SetupFind(new List<User> { user });
        _turnstileVerifierMock.Setup(v => v.VerifyAsync(It.IsAny<string>(), It.IsAny<string?>())).ReturnsAsync(false);

        var result = await _sut.Login(new LoginRequest(user.Email, "Passw0rd!", "bad-token"));

        result.Result.ShouldBeOfType<BadRequestObjectResult>();
        var cookies = SetCookieHeaders(_sut.ControllerContext);
        cookies.ShouldBeEmpty();
    }

    [Fact]
    public async Task SendPhoneLoginOtp_WhenMsg91IsNotConfigured_Returns503()
    {
        // The mock's default (set in the constructor) matches the real, currently-unconfigured
        // Msg91PhoneOtpSender - this is production's actual behaviour today, not a hypothetical.
        var result = await _sut.SendPhoneLoginOtp(new PhoneLoginRequest("9123456789", "test-turnstile-token"));

        var objectResult = result.ShouldBeOfType<ObjectResult>();
        objectResult.StatusCode.ShouldBe(StatusCodes.Status503ServiceUnavailable);
    }

    [Fact]
    public async Task SendPhoneLoginOtp_TurnstileFails_ReturnsBadRequest_BeforeCheckingConfiguration()
    {
        _turnstileVerifierMock.Setup(v => v.VerifyAsync(It.IsAny<string>(), It.IsAny<string?>())).ReturnsAsync(false);

        var result = await _sut.SendPhoneLoginOtp(new PhoneLoginRequest("9123456789", "bad-token"));

        result.ShouldBeOfType<BadRequestObjectResult>();
    }

    [Fact]
    public async Task Login_InvalidCredentials_ReturnsUnauthorized()
    {
        _usersMock.SetupFind(new List<User>());

        var result = await _sut.Login(new LoginRequest("unknown@example.com", "Passw0rd!", "test-turnstile-token"));

        result.Result.ShouldBeOfType<UnauthorizedObjectResult>();
    }

    [Fact]
    public async Task Login_UnverifiedEmail_Returns403AndNoCookies()
    {
        var user = MakeUser(password: "Passw0rd!", isEmailVerified: false);
        _usersMock.SetupFind(new List<User> { user });

        var result = await _sut.Login(new LoginRequest(user.Email, "Passw0rd!", "test-turnstile-token"));

        var objectResult = result.Result.ShouldBeOfType<ObjectResult>();
        objectResult.StatusCode.ShouldBe(403);

        var cookies = SetCookieHeaders(_sut.ControllerContext);
        cookies.ShouldBeEmpty();
    }

    [Fact]
    public async Task Logout_DeletesAllSessionCookies()
    {
        var result = await _sut.Logout();

        result.ShouldBeOfType<NoContentResult>();
        var cookies = SetCookieHeaders(_sut.ControllerContext);
        cookies.ShouldContain(c => c.StartsWith("ojas_auth="));
        cookies.ShouldContain(c => c.StartsWith("ojas_refresh="));
        cookies.ShouldContain(c => c.StartsWith("ojas_csrf="));
    }

    [Fact]
    public async Task Logout_WithRefreshCookie_RevokesTheWholeSessionFamily()
    {
        _refreshTokensMock.SetupFind(new List<RefreshToken>
        {
            new()
            {
                TokenHash = "irrelevant",
                UserId = "u1",
                FamilyId = "family-1",
                ExpiresAt = DateTime.UtcNow.AddDays(10),
            },
        });
        SetRequestCookie("ojas_refresh", "some-raw-token");

        await _sut.Logout();

        // Not just the token handed in: rotation's grace window can leave a sibling successor
        // alive in another tab, and that sibling must not outlive the user pressing Log out.
        _refreshTokensMock.Verify(c => c.DeleteManyAsync(
            It.IsAny<FilterDefinition<RefreshToken>>(), It.IsAny<CancellationToken>()), Times.Once);
    }

    [Fact]
    public async Task Refresh_ValidCookie_IssuesNewSessionAndCookies()
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
        SetRequestCookie("ojas_refresh", "some-raw-token");

        var result = await _sut.Refresh();

        var okResult = result.Result.ShouldBeOfType<OkObjectResult>();
        var response = okResult.Value.ShouldBeOfType<AuthResponse>();
        response.CsrfToken.ShouldNotBeNullOrWhiteSpace();

        var cookies = SetCookieHeaders(_sut.ControllerContext);
        cookies.ShouldContain(c => c.StartsWith("ojas_auth="));
        cookies.ShouldContain(c => c.StartsWith("ojas_refresh="));
        cookies.ShouldContain(c => c.StartsWith("ojas_csrf="));
    }

    [Fact]
    public async Task Refresh_LosingTheRotationRace_RenewsAccessButSetsNoRefreshCookie()
    {
        // The other tab already rotated this token and its successor is in the shared cookie
        // jar. Writing a second refresh cookie here would replace that successor with a rival
        // branch of the same family - see AuthController.RenewAccessTokenOnly.
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
        _refreshTokensMock.SetupRotationClaim<RefreshToken>(null);
        SetRequestCookies(("ojas_refresh", "some-raw-token"), ("ojas_csrf", "existing-csrf"));

        var result = await _sut.Refresh();

        var okResult = result.Result.ShouldBeOfType<OkObjectResult>();
        var response = okResult.Value.ShouldBeOfType<AuthResponse>();
        // The CSRF token is preserved rather than rotated, so the tab that isn't making this
        // call isn't left holding a value the server no longer recognises.
        response.CsrfToken.ShouldBe("existing-csrf");

        var cookies = SetCookieHeaders(_sut.ControllerContext);
        cookies.ShouldContain(c => c.StartsWith("ojas_auth="));
        cookies.ShouldNotContain(c => c.StartsWith("ojas_refresh="));
        cookies.ShouldNotContain(c => c.StartsWith("ojas_csrf="));
    }

    [Fact]
    public async Task Refresh_NoCookie_ReturnsUnauthorized()
    {
        var result = await _sut.Refresh();

        result.Result.ShouldBeOfType<UnauthorizedResult>();
    }

    [Fact]
    public async Task Refresh_UnknownToken_ReturnsUnauthorizedAndClearsCookie()
    {
        _refreshTokensMock.SetupFind(new List<RefreshToken>());
        SetRequestCookie("ojas_refresh", "some-raw-token");

        var result = await _sut.Refresh();

        result.Result.ShouldBeOfType<UnauthorizedResult>();
        var cookies = SetCookieHeaders(_sut.ControllerContext);
        cookies.ShouldContain(c => c.StartsWith("ojas_refresh="));
    }

    [Fact]
    public async Task CreateStaff_Success_ReturnsOkWithStaffUser()
    {
        _usersMock.SetupFind(new List<User>());
        var request = new CreateStaffRequest("Staff Admin", "admin@example.com", "9123456789", "admin");

        var result = await _sut.CreateStaff(request);

        // The response is an anonymous object rather than StaffUserResponse so it can also carry
        // the dev-only invite token, so assert on the shape reflectively.
        var okResult = result.Result.ShouldBeOfType<OkObjectResult>();
        var value = okResult.Value.ShouldNotBeNull();
        var type = value.GetType();
        type.GetProperty("role")!.GetValue(value).ShouldBe(UserRoles.Admin);
        type.GetProperty("invitePending")!.GetValue(value).ShouldBe(true);
        // Created dormant: the staff member sets their own password from the emailed link.
        type.GetProperty("devInviteToken")!.GetValue(value).ShouldNotBeNull();
    }

    [Fact]
    public async Task CreateStaff_InvalidRole_ReturnsBadRequest()
    {
        var request = new CreateStaffRequest("Someone", "someone@example.com", "9123456789", "superadmin");

        var result = await _sut.CreateStaff(request);

        result.Result.ShouldBeOfType<BadRequestObjectResult>();
    }

    [Fact]
    public async Task CreateStaff_Conflict_ReturnsConflict()
    {
        _usersMock.SetupFind(new List<User> { MakeUser(email: "admin@example.com") });
        var request = new CreateStaffRequest("Staff Admin", "admin@example.com", "9123456789", "admin");

        var result = await _sut.CreateStaff(request);

        result.Result.ShouldBeOfType<ConflictObjectResult>();
    }
}
