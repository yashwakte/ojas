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

    private static CampaignBanner MakeBanner(string title = "Summer Sale") => new() { Title = title };

    [Fact]
    public async Task GetBanner_ReturnsNotFound_WhenNoBannerExists()
    {
        _bannersMock.SetupFind(new List<CampaignBanner>());

        var result = await _sut.GetBanner();

        result.Result.ShouldBeOfType<NotFoundResult>();
    }

    [Fact]
    public async Task GetBanner_ReturnsOk_WhenBannerExists()
    {
        _bannersMock.SetupFind(new List<CampaignBanner> { MakeBanner() });

        var result = await _sut.GetBanner();

        result.Result.ShouldBeOfType<OkObjectResult>();
    }

    [Fact]
    public async Task UpdateBanner_UpsertsAndReturnsOk()
    {
        _bannersMock.SetupFind(new List<CampaignBanner>());
        var request = MakeBanner("Winter Sale");

        var result = await _sut.UpdateBanner(request);

        var okResult = result.Result.ShouldBeOfType<OkObjectResult>();
        var banner = okResult.Value.ShouldBeOfType<CampaignBanner>();
        banner.Title.ShouldBe("Winter Sale");
        _bannersMock.Verify(c => c.InsertOneAsync(It.IsAny<CampaignBanner>(), null, It.IsAny<CancellationToken>()), Times.Once);
    }
}
