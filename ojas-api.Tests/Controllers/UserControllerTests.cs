using System.Security.Claims;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Moq;
using MongoDB.Bson;
using MongoDB.Driver;
using OjasApi.Controllers;
using OjasApi.Models;
using OjasApi.Services;
using OjasApi.Tests.TestHelpers;
using Shouldly;

namespace OjasApi.Tests.Controllers;

public class UserControllerTests
{
    private const string UserId = "507f1f77bcf86cd799439011";

    private readonly Mock<IMongoDbService> _dbMock = new();
    private readonly Mock<IMongoCollection<User>> _usersMock = new();
    private readonly UserController _sut;

    public UserControllerTests()
    {
        _dbMock.Setup(d => d.Users).Returns(_usersMock.Object);
        _sut = new UserController(_dbMock.Object);
        SetUser(UserId);
    }

    private void SetUser(string userId)
    {
        var identity = new ClaimsIdentity([new Claim(ClaimTypes.NameIdentifier, userId)], "TestAuth");
        _sut.ControllerContext = new ControllerContext
        {
            HttpContext = new DefaultHttpContext { User = new ClaimsPrincipal(identity) },
        };
    }

    private static User MakeUser(string id = UserId, string email = "jane@example.com", string phone = "9123456789", List<SavedAddress>? addresses = null) => new()
    {
        Id = id,
        FullName = "Jane Doe",
        Email = email,
        Phone = phone,
        PasswordHash = "hash",
        Role = UserRoles.Customer,
        SavedAddresses = addresses ?? [],
    };

    /// <summary>Overrides just the AnyAsync-path (BsonDocument-projected FindAsync overload) that
    /// SetupFind wires up from the "current user" data, so email/phone conflict checks can be
    /// controlled independently of the FirstOrDefaultAsync-path used to load the current user.</summary>
    private void SetConflictCheckResult(bool anyMatches)
    {
        var data = anyMatches ? new List<BsonDocument> { new() } : [];
        _usersMock
            .Setup(c => c.FindAsync(
                It.IsAny<FilterDefinition<User>>(),
                It.IsAny<FindOptions<User, BsonDocument>>(),
                It.IsAny<CancellationToken>()))
            .ReturnsAsync(data.ToMockCursor().Object);
    }

    // ---------- GetProfile ----------

    [Fact]
    public async Task GetProfile_ReturnsOk_WhenUserExists()
    {
        _usersMock.SetupFind(new List<User> { MakeUser() });

        var result = await _sut.GetProfile();

        var okResult = result.Result.ShouldBeOfType<OkObjectResult>();
        var profile = okResult.Value.ShouldBeOfType<UserProfileResponse>();
        profile.Email.ShouldBe("jane@example.com");
    }

    [Fact]
    public async Task GetProfile_ReturnsNotFound_WhenUserMissing()
    {
        _usersMock.SetupFind(new List<User>());

        var result = await _sut.GetProfile();

        result.Result.ShouldBeOfType<NotFoundResult>();
    }

    // ---------- UpdateProfile ----------

    [Fact]
    public async Task UpdateProfile_ReturnsConflict_WhenEmailAlreadyUsedByAnotherAccount()
    {
        var current = MakeUser();
        _usersMock.SetupFind(new List<User> { current });
        SetConflictCheckResult(anyMatches: true);

        var result = await _sut.UpdateProfile(new UpdateProfileRequest("Jane Doe", "taken@example.com", current.Phone));

        var conflict = result.ShouldBeOfType<ConflictObjectResult>();
        conflict.Value.ShouldNotBeNull();
    }

    [Fact]
    public async Task UpdateProfile_ReturnsNoContent_WhenNoConflicts()
    {
        var current = MakeUser();
        _usersMock.SetupFind(new List<User> { current });
        SetConflictCheckResult(anyMatches: false);
        _usersMock
            .Setup(c => c.UpdateOneAsync(It.IsAny<FilterDefinition<User>>(), It.IsAny<UpdateDefinition<User>>(), It.IsAny<UpdateOptions>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync(new UpdateResult.Acknowledged(1, 1, null));

        var result = await _sut.UpdateProfile(new UpdateProfileRequest("Jane New Name", "jane@example.com", current.Phone));

        result.ShouldBeOfType<NoContentResult>();
    }

    [Fact]
    public async Task UpdateProfile_ReturnsNotFound_WhenUserMissing()
    {
        _usersMock.SetupFind(new List<User>());

        var result = await _sut.UpdateProfile(new UpdateProfileRequest("Jane Doe", "jane@example.com", "9123456789"));

        result.ShouldBeOfType<NotFoundResult>();
    }

    // ---------- GetAddresses ----------

    [Fact]
    public async Task GetAddresses_ReturnsSavedAddresses()
    {
        var addresses = new List<SavedAddress>
        {
            new() { Label = "Home", FullAddress = "123 Main St", Latitude = 18.5, Longitude = 73.8, IsDefault = true },
        };
        _usersMock.SetupFind(new List<User> { MakeUser(addresses: addresses) });

        var result = await _sut.GetAddresses();

        var okResult = result.Result.ShouldBeOfType<OkObjectResult>();
        var response = okResult.Value.ShouldBeOfType<List<SavedAddressDto>>();
        response.Count.ShouldBe(1);
        response[0].Label.ShouldBe("Home");
    }

    // ---------- AddAddress ----------

    [Fact]
    public async Task AddAddress_ReturnsBadRequest_WhenLatLngMissing()
    {
        var request = new SaveAddressRequest("Home", "123 Main St", null, null, false, "9123456780");

        var result = await _sut.AddAddress(request);

        result.ShouldBeOfType<BadRequestObjectResult>();
    }

    [Fact]
    public async Task AddAddress_IssuesThreeUpdates_WhenMarkedDefault_ToClearOtherDefaultsFirst()
    {
        var request = new SaveAddressRequest("Home", "123 Main St", 18.5, 73.8, true, "9123456780");

        var result = await _sut.AddAddress(request);

        result.ShouldBeOfType<OkObjectResult>();
        _usersMock.Verify(
            c => c.UpdateOneAsync(It.IsAny<FilterDefinition<User>>(), It.IsAny<UpdateDefinition<User>>(), It.IsAny<UpdateOptions>(), It.IsAny<CancellationToken>()),
            Times.Exactly(3));
    }

    [Fact]
    public async Task AddAddress_IssuesTwoUpdates_WhenNotDefault()
    {
        var request = new SaveAddressRequest("Work", "456 Side St", 18.6, 73.9, false, "9123456781");

        var result = await _sut.AddAddress(request);

        result.ShouldBeOfType<OkObjectResult>();
        _usersMock.Verify(
            c => c.UpdateOneAsync(It.IsAny<FilterDefinition<User>>(), It.IsAny<UpdateDefinition<User>>(), It.IsAny<UpdateOptions>(), It.IsAny<CancellationToken>()),
            Times.Exactly(2));
    }

    // ---------- DeleteAddress ----------

    [Fact]
    public async Task DeleteAddress_ReturnsBadRequest_WhenIndexOutOfBounds()
    {
        _usersMock.SetupFind(new List<User> { MakeUser(addresses: []) });

        var result = await _sut.DeleteAddress(0);

        result.ShouldBeOfType<BadRequestObjectResult>();
    }

    [Fact]
    public async Task DeleteAddress_RemovesAddressAtIndex_WhenValid()
    {
        var addresses = new List<SavedAddress>
        {
            new() { Label = "Home", FullAddress = "A", Latitude = 1, Longitude = 1 },
            new() { Label = "Work", FullAddress = "B", Latitude = 2, Longitude = 2 },
        };
        _usersMock.SetupFind(new List<User> { MakeUser(addresses: addresses) });

        var result = await _sut.DeleteAddress(0);

        result.ShouldBeOfType<OkObjectResult>();
        _usersMock.Verify(
            c => c.UpdateOneAsync(It.IsAny<FilterDefinition<User>>(), It.IsAny<UpdateDefinition<User>>(), It.IsAny<UpdateOptions>(), It.IsAny<CancellationToken>()),
            Times.Once);
    }

    [Fact]
    public async Task DeleteAddress_ReturnsNotFound_WhenUserMissing()
    {
        _usersMock.SetupFind(new List<User>());

        var result = await _sut.DeleteAddress(0);

        result.ShouldBeOfType<NotFoundResult>();
    }

    // ---------- BuildMapLink (internal static) ----------

    [Fact]
    public void BuildMapLink_GeneratesGoogleMapsUrl_WithInvariantCultureCoordinates()
    {
        var link = UserController.BuildMapLink(18.5204, 73.8567);

        link.ShouldBe("https://www.google.com/maps?q=18.5204,73.8567");
    }
}
