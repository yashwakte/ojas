using MongoDB.Driver;
using OjasApi.Models;

namespace OjasApi.Services;

public class CampaignBannerService
{
    private readonly IMongoDbService _db;

    public CampaignBannerService(IMongoDbService db)
    {
        _db = db;
    }

    public async Task<List<CampaignBanner>> GetAllAsync()
    {
        return await _db.CampaignBanners.Find(_ => true).SortBy(c => c.CreatedAt).ToListAsync();
    }

    public async Task<CampaignBanner?> GetByIdAsync(string id)
    {
        return await _db.CampaignBanners.Find(c => c.Id == id).FirstOrDefaultAsync();
    }

    public async Task<CampaignBanner> CreateAsync(CampaignBanner banner)
    {
        banner.Id = null;
        banner.CreatedAt = DateTime.UtcNow;
        banner.UpdatedAt = DateTime.UtcNow;
        await _db.CampaignBanners.InsertOneAsync(banner);
        return banner;
    }

    public async Task<CampaignBanner?> UpdateAsync(string id, CampaignBanner banner)
    {
        var existing = await GetByIdAsync(id);
        if (existing == null)
        {
            return null;
        }

        banner.Id = existing.Id;
        banner.CreatedAt = existing.CreatedAt;
        banner.UpdatedAt = DateTime.UtcNow;

        await _db.CampaignBanners.ReplaceOneAsync(c => c.Id == id, banner);
        return banner;
    }

    public async Task<bool> DeleteAsync(string id)
    {
        var result = await _db.CampaignBanners.DeleteOneAsync(c => c.Id == id);
        return result.DeletedCount > 0;
    }
}
