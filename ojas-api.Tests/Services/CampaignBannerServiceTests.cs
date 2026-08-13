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
    public async Task GetAllAsync_ReturnsEmptyList_WhenNoBannersExist()
    {
        _bannersMock.SetupFind(new List<CampaignBanner>());

        var result = await _sut.GetAllAsync();

        result.ShouldBeEmpty();
    }

    [Fact]
    public async Task GetAllAsync_ReturnsAllBanners()
    {
        var banners = new List<CampaignBanner> { MakeBanner("First"), MakeBanner("Second") };
        _bannersMock.SetupFind(banners);

        var result = await _sut.GetAllAsync();

        result.Count.ShouldBe(2);
    }

    [Fact]
    public async Task GetByIdAsync_ReturnsNull_WhenNotFound()
    {
        _bannersMock.SetupFind(new List<CampaignBanner>());

        var result = await _sut.GetByIdAsync("507f1f77bcf86cd799439011");

        result.ShouldBeNull();
    }

    [Fact]
    public async Task CreateAsync_InsertsNewBanner_WithFreshTimestamps()
    {
        _bannersMock.SetupFind(new List<CampaignBanner>());
        var incoming = new CampaignBanner { Title = "New Sale" };

        var result = await _sut.CreateAsync(incoming);

        result.Title.ShouldBe("New Sale");
        _bannersMock.Verify(c => c.InsertOneAsync(incoming, null, It.IsAny<CancellationToken>()), Times.Once);
    }

    [Fact]
    public async Task UpdateAsync_ReturnsNull_WhenBannerDoesNotExist()
    {
        _bannersMock.SetupFind(new List<CampaignBanner>());

        var result = await _sut.UpdateAsync("507f1f77bcf86cd799439011", MakeBanner("Updated"));

        result.ShouldBeNull();
        _bannersMock.Verify(
            c => c.ReplaceOneAsync(It.IsAny<FilterDefinition<CampaignBanner>>(), It.IsAny<CampaignBanner>(), It.IsAny<ReplaceOptions>(), It.IsAny<CancellationToken>()),
            Times.Never);
    }

    [Fact]
    public async Task UpdateAsync_Replaces_AndPreservesOriginalIdAndCreatedAt_WhenBannerExists()
    {
        var existing = MakeBanner();
        _bannersMock.SetupFind(new List<CampaignBanner> { existing });

        var incoming = new CampaignBanner { Title = "Winter Sale" };

        var result = await _sut.UpdateAsync(existing.Id!, incoming);

        result!.Id.ShouldBe(existing.Id);
        result.CreatedAt.ShouldBe(existing.CreatedAt);
        result.Title.ShouldBe("Winter Sale");
        _bannersMock.Verify(
            c => c.ReplaceOneAsync(It.IsAny<FilterDefinition<CampaignBanner>>(), incoming, It.IsAny<ReplaceOptions>(), It.IsAny<CancellationToken>()),
            Times.Once);
    }

    [Fact]
    public async Task DeleteAsync_ReturnsTrue_WhenDeleted()
    {
        _bannersMock
            .Setup(c => c.DeleteOneAsync(It.IsAny<FilterDefinition<CampaignBanner>>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync(new DeleteResult.Acknowledged(1));

        var result = await _sut.DeleteAsync("507f1f77bcf86cd799439011");

        result.ShouldBeTrue();
    }

    [Fact]
    public async Task DeleteAsync_ReturnsFalse_WhenNothingDeleted()
    {
        _bannersMock
            .Setup(c => c.DeleteOneAsync(It.IsAny<FilterDefinition<CampaignBanner>>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync(new DeleteResult.Acknowledged(0));

        var result = await _sut.DeleteAsync("507f1f77bcf86cd799439011");

        result.ShouldBeFalse();
    }
}
