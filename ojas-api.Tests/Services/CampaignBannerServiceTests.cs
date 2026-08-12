using Moq;
using MongoDB.Driver;
using OjasApi.Models;
using OjasApi.Services;
using OjasApi.Tests.TestHelpers;
using Shouldly;

namespace OjasApi.Tests.Services;

public class CampaignBannerServiceTests
{
    private readonly Mock<IMongoDbService> _dbMock = new();
    private readonly Mock<IMongoCollection<CampaignBanner>> _bannersMock = new();
    private readonly CampaignBannerService _sut;

    public CampaignBannerServiceTests()
    {
        _dbMock.Setup(d => d.CampaignBanners).Returns(_bannersMock.Object);
        _sut = new CampaignBannerService(_dbMock.Object);
    }

    private static CampaignBanner MakeBanner(string title = "Summer Sale") => new()
    {
        Id = "507f1f77bcf86cd799439011",
        Title = title,
        CreatedAt = new DateTime(2025, 1, 1, 0, 0, 0, DateTimeKind.Utc),
    };

    [Fact]
    public async Task GetAsync_ReturnsNull_WhenNoBannerExists()
    {
        _bannersMock.SetupFind(new List<CampaignBanner>());

        var result = await _sut.GetAsync();

        result.ShouldBeNull();
    }

    [Fact]
    public async Task GetAsync_ReturnsBanner_WhenOneExists()
    {
        var banner = MakeBanner();
        _bannersMock.SetupFind(new List<CampaignBanner> { banner });

        var result = await _sut.GetAsync();

        result.ShouldBe(banner);
    }

    [Fact]
    public async Task UpsertAsync_Inserts_WhenNoBannerExists()
    {
        _bannersMock.SetupFind(new List<CampaignBanner>());
        var incoming = MakeBanner();
        incoming.Id = null;

        var result = await _sut.UpsertAsync(incoming);

        _bannersMock.Verify(c => c.InsertOneAsync(incoming, null, It.IsAny<CancellationToken>()), Times.Once);
        _bannersMock.Verify(
            c => c.ReplaceOneAsync(It.IsAny<FilterDefinition<CampaignBanner>>(), It.IsAny<CampaignBanner>(), It.IsAny<ReplaceOptions>(), It.IsAny<CancellationToken>()),
            Times.Never);
        result.ShouldBe(incoming);
    }

    [Fact]
    public async Task UpsertAsync_Replaces_AndPreservesOriginalIdAndCreatedAt_WhenBannerExists()
    {
        var existing = MakeBanner();
        _bannersMock.SetupFind(new List<CampaignBanner> { existing });

        var incoming = MakeBanner(title: "Winter Sale");
        incoming.Id = null;
        incoming.CreatedAt = default;

        var result = await _sut.UpsertAsync(incoming);

        result.Id.ShouldBe(existing.Id);
        result.CreatedAt.ShouldBe(existing.CreatedAt);
        result.Title.ShouldBe("Winter Sale");
        _bannersMock.Verify(
            c => c.ReplaceOneAsync(It.IsAny<FilterDefinition<CampaignBanner>>(), incoming, It.IsAny<ReplaceOptions>(), It.IsAny<CancellationToken>()),
            Times.Once);
        _bannersMock.Verify(c => c.InsertOneAsync(It.IsAny<CampaignBanner>(), null, It.IsAny<CancellationToken>()), Times.Never);
    }
}
