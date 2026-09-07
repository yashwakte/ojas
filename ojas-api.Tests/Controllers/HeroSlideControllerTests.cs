using Microsoft.AspNetCore.Mvc;
using Moq;
using MongoDB.Driver;
using OjasApi.Controllers;
using OjasApi.Models;
using OjasApi.Services;
using OjasApi.Tests.TestHelpers;
using Shouldly;

namespace OjasApi.Tests.Controllers;

public class HeroSlideControllerTests
{
    private readonly Mock<IMongoDbService> _dbMock = new();
    private readonly Mock<IMongoCollection<HeroSlide>> _slidesMock = new();
    private readonly HeroSlideController _sut;

    public HeroSlideControllerTests()
    {
        _dbMock.Setup(d => d.HeroSlides).Returns(_slidesMock.Object);
        _sut = new HeroSlideController(new HeroSlideService(_dbMock.Object));
    }

    private static HeroSlide MakeSlide(string alt = "The fasting range") => new()
    {
        Id = "507f1f77bcf86cd799439011",
        ImageUrl = "/api/media/poster.webp",
        AltText = alt,
    };

    [Fact]
    public async Task GetSlides_ReturnsEmptyList_WhenNoneExist()
    {
        _slidesMock.SetupFind(new List<HeroSlide>());

        var result = await _sut.GetSlides();

        var ok = result.Result.ShouldBeOfType<OkObjectResult>();
        ok.Value.ShouldBeOfType<List<HeroSlide>>().ShouldBeEmpty();
    }

    [Fact]
    public async Task GetSlides_ReturnsAllSlides()
    {
        _slidesMock.SetupFind(new List<HeroSlide> { MakeSlide("First"), MakeSlide("Second") });

        var result = await _sut.GetSlides();

        var ok = result.Result.ShouldBeOfType<OkObjectResult>();
        ok.Value.ShouldBeOfType<List<HeroSlide>>().Count.ShouldBe(2);
    }

    [Fact]
    public async Task CreateSlide_InsertsAndReturnsOk()
    {
        _slidesMock.SetupFind(new List<HeroSlide>());

        var result = await _sut.CreateSlide(MakeSlide("A new poster"));

        var ok = result.Result.ShouldBeOfType<OkObjectResult>();
        ok.Value.ShouldBeOfType<HeroSlide>().AltText.ShouldBe("A new poster");
        _slidesMock.Verify(
            c => c.InsertOneAsync(It.IsAny<HeroSlide>(), null, It.IsAny<CancellationToken>()),
            Times.Once);
    }

    [Fact]
    public async Task CreateSlide_RejectsASlideWithNoPicture()
    {
        // A slide is nothing but its picture, so one without an image would render as an empty
        // frame on the largest thing in the first screenful.
        var result = await _sut.CreateSlide(new HeroSlide { ImageUrl = "  " });

        result.Result.ShouldBeOfType<BadRequestObjectResult>();
        _slidesMock.Verify(
            c => c.InsertOneAsync(It.IsAny<HeroSlide>(), null, It.IsAny<CancellationToken>()),
            Times.Never);
    }

    [Fact]
    public async Task UpdateSlide_ReturnsNotFound_WhenSlideDoesNotExist()
    {
        _slidesMock.SetupFind(new List<HeroSlide>());

        var result = await _sut.UpdateSlide("507f1f77bcf86cd799439011", MakeSlide("Updated"));

        result.Result.ShouldBeOfType<NotFoundResult>();
    }

    [Fact]
    public async Task UpdateSlide_ReturnsOk_WhenSlideExists()
    {
        var existing = MakeSlide();
        _slidesMock.SetupFind(new List<HeroSlide> { existing });

        var result = await _sut.UpdateSlide(existing.Id!, MakeSlide("Updated"));

        var ok = result.Result.ShouldBeOfType<OkObjectResult>();
        ok.Value.ShouldBeOfType<HeroSlide>().AltText.ShouldBe("Updated");
    }

    [Fact]
    public async Task UpdateSlide_RejectsASlideWithNoPicture()
    {
        var result = await _sut.UpdateSlide("507f1f77bcf86cd799439011", new HeroSlide { ImageUrl = "" });

        result.Result.ShouldBeOfType<BadRequestObjectResult>();
    }

    [Fact]
    public async Task DeleteSlide_ReturnsNotFound_WhenNothingDeleted()
    {
        _slidesMock
            .Setup(c => c.DeleteOneAsync(It.IsAny<FilterDefinition<HeroSlide>>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync(new DeleteResult.Acknowledged(0));

        var result = await _sut.DeleteSlide("507f1f77bcf86cd799439011");

        result.ShouldBeOfType<NotFoundResult>();
    }

    [Fact]
    public async Task DeleteSlide_ReturnsNoContent_WhenDeleted()
    {
        _slidesMock
            .Setup(c => c.DeleteOneAsync(It.IsAny<FilterDefinition<HeroSlide>>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync(new DeleteResult.Acknowledged(1));

        var result = await _sut.DeleteSlide("507f1f77bcf86cd799439011");

        result.ShouldBeOfType<NoContentResult>();
    }

    [Fact]
    public async Task UpdateSlide_KeepsTheOriginalCreatedAt()
    {
        // CreatedAt is the tie-break the rail's running order falls back on, so an edit that
        // stamped it fresh would quietly reshuffle slides the owner never touched.
        var created = new DateTime(2026, 1, 1, 0, 0, 0, DateTimeKind.Utc);
        var existing = MakeSlide();
        existing.CreatedAt = created;
        _slidesMock.SetupFind(new List<HeroSlide> { existing });

        var result = await _sut.UpdateSlide(existing.Id!, MakeSlide("Updated"));

        var ok = result.Result.ShouldBeOfType<OkObjectResult>();
        ok.Value.ShouldBeOfType<HeroSlide>().CreatedAt.ShouldBe(created);
    }
}
