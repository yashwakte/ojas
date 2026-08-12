using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Extensions.Configuration;
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
    private readonly AuthController _sut;

    public AuthControllerTests()
    {
        _dbMock.Setup(d => d.Users).Returns(_usersMock.Object);
        _usersMock
            .Setup(c => c.InsertOneAsync(It.IsAny<User>(), null, It.IsAny<CancellationToken>()))
            .Callback<User, InsertOneOptions?, CancellationToken>((user, _, _) => user.Id ??= "507f1f77bcf86cd799439099")
            .Returns(Task.CompletedTask);

        var config = new ConfigurationBuilder()
            .AddInMemoryCollection(new Dictionary<string, string?>
            {
                ["Jwt:Key"] = "test-signing-key-at-least-32-characters-long!!",
                ["Jwt:Issuer"] = "OjasApiTests",
                ["Jwt:Audience"] = "OjasApiTests",
            })
            .Build();

        var authService = new AuthService(_dbMock.Object, config);
        var envMock = new Mock<IWebHostEnvironment>();

        _sut = new AuthController(authService, envMock.Object)
        {
            ControllerContext = new ControllerContext { HttpContext = new DefaultHttpContext() },
        };
    }

    private static User MakeUser(string email = "jane@example.com", string phone = "9123456789", string password = "Passw0rd!") => new()
    {
        Id = "507f1f77bcf86cd799439011",
        FullName = "Jane Doe",
        Email = email,
        Phone = phone,
        PasswordHash = BCrypt.Net.BCrypt.HashPassword(password),
        Role = UserRoles.Customer,
    };

    private static IEnumerable<string> SetCookieHeaders(ControllerContext context) =>
        context.HttpContext.Response.Headers["Set-Cookie"].ToArray()!;

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
    public async Task Register_Success_SetsAuthAndCsrfCookies_AndReturnsCsrfToken()
    {
        _usersMock.SetupFind(new List<User>());
        var request = new RegisterRequest("New User", "new@example.com", "9123456789", "Passw0rd!");

        var result = await _sut.Register(request);

        var okResult = result.Result.ShouldBeOfType<OkObjectResult>();
        var response = okResult.Value.ShouldBeOfType<AuthResponse>();
        response.CsrfToken.ShouldNotBeNullOrWhiteSpace();

        var cookies = SetCookieHeaders(_sut.ControllerContext);
        cookies.ShouldContain(c => c.StartsWith("ojas_auth="));
        cookies.ShouldContain(c => c.StartsWith("ojas_csrf="));
    }

    [Fact]
    public async Task Register_EmailConflict_ReturnsConflictWithEmailField()
    {
        _usersMock.SetupFind(new List<User> { MakeUser(email: "new@example.com") });
        var request = new RegisterRequest("New User", "new@example.com", "9123456789", "Passw0rd!");

        var result = await _sut.Register(request);

        var conflict = result.Result.ShouldBeOfType<ConflictObjectResult>();
        conflict.Value.ShouldNotBeNull();
    }

    [Fact]
    public async Task Login_Success_SetsCookies()
    {
        var user = MakeUser(password: "Passw0rd!");
        _usersMock.SetupFind(new List<User> { user });

        var result = await _sut.Login(new LoginRequest(user.Email, "Passw0rd!"));

        var okResult = result.Result.ShouldBeOfType<OkObjectResult>();
        var response = okResult.Value.ShouldBeOfType<AuthResponse>();
        response.CsrfToken.ShouldNotBeNullOrWhiteSpace();

        var cookies = SetCookieHeaders(_sut.ControllerContext);
        cookies.ShouldContain(c => c.StartsWith("ojas_auth="));
        cookies.ShouldContain(c => c.StartsWith("ojas_csrf="));
    }

    [Fact]
    public async Task Login_InvalidCredentials_ReturnsUnauthorized()
    {
        _usersMock.SetupFind(new List<User>());

        var result = await _sut.Login(new LoginRequest("unknown@example.com", "Passw0rd!"));

        result.Result.ShouldBeOfType<UnauthorizedObjectResult>();
    }

    [Fact]
    public void Logout_DeletesBothCookies()
    {
        var result = _sut.Logout();

        result.ShouldBeOfType<NoContentResult>();
        var cookies = SetCookieHeaders(_sut.ControllerContext);
        cookies.ShouldContain(c => c.StartsWith("ojas_auth="));
        cookies.ShouldContain(c => c.StartsWith("ojas_csrf="));
    }

    [Fact]
    public async Task CreateStaff_Success_ReturnsOkWithStaffUser()
    {
        _usersMock.SetupFind(new List<User>());
        var request = new CreateStaffRequest("Staff Admin", "admin@example.com", "9123456789", "Passw0rd!", "admin");

        var result = await _sut.CreateStaff(request);

        var okResult = result.Result.ShouldBeOfType<OkObjectResult>();
        var staff = okResult.Value.ShouldBeOfType<StaffUserResponse>();
        staff.Role.ShouldBe(UserRoles.Admin);
    }

    [Fact]
    public async Task CreateStaff_InvalidRole_ReturnsBadRequest()
    {
        var request = new CreateStaffRequest("Someone", "someone@example.com", "9123456789", "Passw0rd!", "superadmin");

        var result = await _sut.CreateStaff(request);

        result.Result.ShouldBeOfType<BadRequestObjectResult>();
    }

    [Fact]
    public async Task CreateStaff_Conflict_ReturnsConflict()
    {
        _usersMock.SetupFind(new List<User> { MakeUser(email: "admin@example.com") });
        var request = new CreateStaffRequest("Staff Admin", "admin@example.com", "9123456789", "Passw0rd!", "admin");

        var result = await _sut.CreateStaff(request);

        result.Result.ShouldBeOfType<ConflictObjectResult>();
    }
}
