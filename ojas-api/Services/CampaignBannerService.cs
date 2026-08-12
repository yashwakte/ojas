using MongoDB.Driver;
using OjasApi.Models;

namespace OjasApi.Services;

public class CampaignBannerService
{
    private readonly MongoDbService _db;

    public CampaignBannerService(MongoDbService db)
    {
        _db = db;
    }

    public async Task<CampaignBanner?> GetAsync()
    {
        return await _db.CampaignBanners.Find(_ => true).FirstOrDefaultAsync();
    }

    public async Task<CampaignBanner> UpsertAsync(CampaignBanner banner)
    {
        banner.UpdatedAt = DateTime.UtcNow;

        var existing = await GetAsync();
        if (existing == null)
        {
            banner.CreatedAt = DateTime.UtcNow;
            await _db.CampaignBanners.InsertOneAsync(banner);
            return banner;
        }

        banner.Id = existing.Id;
        banner.CreatedAt = existing.CreatedAt;

        await _db.CampaignBanners.ReplaceOneAsync(c => c.Id == existing.Id, banner);
        return banner;
    }
}
