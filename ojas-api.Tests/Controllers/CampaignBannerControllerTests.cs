using Microsoft.AspNetCore.Mvc;
using Moq;
using MongoDB.Driver;
using OjasApi.Controllers;
using OjasApi.Models;
using OjasApi.Services;
using OjasApi.Tests.TestHelpers;
using Shouldly;

namespace OjasApi.Tests.Controllers;

public class CampaignBannerControllerTests
{
    private readonly Mock<IMongoDbService> _dbMock = new();
    private readonly Mock<IMongoCollection<CampaignBanner>> _bannersMock = new();
    private readonly CampaignBannerController _sut;

    public CampaignBannerControllerTests()
    {
        _dbMock.Setup(d => d.CampaignBanners).Returns(_bannersMock.Object);
        var service = new CampaignBannerService(_dbMock.Object);
        _sut = new CampaignBannerController(service);
    }

    private static CampaignBanner MakeBanner(string title = "Summer Sale") => new() { Id = "507f1f77bcf86cd799439011", Title = title };

    [Fact]
    public async Task GetBanners_ReturnsEmptyList_WhenNoneExist()
    {
        _bannersMock.SetupFind(new List<CampaignBanner>());

        var result = await _sut.GetBanners();

        var okResult = result.Result.ShouldBeOfType<OkObjectResult>();
        var banners = okResult.Value.ShouldBeOfType<List<CampaignBanner>>();
        banners.ShouldBeEmpty();
    }

    [Fact]
    public async Task GetBanners_ReturnsAllBanners()
    {
        _bannersMock.SetupFind(new List<CampaignBanner> { MakeBanner("First"), MakeBanner("Second") });

        var result = await _sut.GetBanners();

        var okResult = result.Result.ShouldBeOfType<OkObjectResult>();
        var banners = okResult.Value.ShouldBeOfType<List<CampaignBanner>>();
        banners.Count.ShouldBe(2);
    }

    [Fact]
    public async Task CreateBanner_InsertsAndReturnsOk()
    {
        _bannersMock.SetupFind(new List<CampaignBanner>());
        var request = MakeBanner("Winter Sale");

        var result = await _sut.CreateBanner(request);

        var okResult = result.Result.ShouldBeOfType<OkObjectResult>();
        var banner = okResult.Value.ShouldBeOfType<CampaignBanner>();
        banner.Title.ShouldBe("Winter Sale");
        _bannersMock.Verify(c => c.InsertOneAsync(It.IsAny<CampaignBanner>(), null, It.IsAny<CancellationToken>()), Times.Once);
    }

    [Fact]
    public async Task UpdateBanner_ReturnsNotFound_WhenBannerDoesNotExist()
    {
        _bannersMock.SetupFind(new List<CampaignBanner>());

        var result = await _sut.UpdateBanner("507f1f77bcf86cd799439011", MakeBanner("Updated"));

        result.Result.ShouldBeOfType<NotFoundResult>();
    }

    [Fact]
    public async Task UpdateBanner_ReturnsOk_WhenBannerExists()
    {
        var existing = MakeBanner();
        _bannersMock.SetupFind(new List<CampaignBanner> { existing });

        var result = await _sut.UpdateBanner(existing.Id!, MakeBanner("Updated"));

        var okResult = result.Result.ShouldBeOfType<OkObjectResult>();
        var banner = okResult.Value.ShouldBeOfType<CampaignBanner>();
        banner.Title.ShouldBe("Updated");
    }

    [Fact]
    public async Task DeleteBanner_ReturnsNotFound_WhenNothingDeleted()
    {
        _bannersMock
            .Setup(c => c.DeleteOneAsync(It.IsAny<FilterDefinition<CampaignBanner>>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync(new DeleteResult.Acknowledged(0));

        var result = await _sut.DeleteBanner("507f1f77bcf86cd799439011");

        result.ShouldBeOfType<NotFoundResult>();
    }

    [Fact]
    public async Task DeleteBanner_ReturnsNoContent_WhenDeleted()
    {
        _bannersMock
            .Setup(c => c.DeleteOneAsync(It.IsAny<FilterDefinition<CampaignBanner>>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync(new DeleteResult.Acknowledged(1));

        var result = await _sut.DeleteBanner("507f1f77bcf86cd799439011");

        result.ShouldBeOfType<NoContentResult>();
    }
}
