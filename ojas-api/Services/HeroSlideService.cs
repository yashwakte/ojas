using MongoDB.Driver;
using OjasApi.Models;

namespace OjasApi.Services;

public class HeroSlideService
{
    private readonly IMongoDbService _db;

    public HeroSlideService(IMongoDbService db)
    {
        _db = db;
    }

    /// <summary>
    /// Every slide, in the order the carousel plays them. SortOrder first so the owner can
    /// decide what a visitor sees on arrival, CreatedAt as the tie-break so slides that were
    /// never explicitly ordered are still stable rather than arbitrary.
    /// </summary>
    public async Task<List<HeroSlide>> GetAllAsync()
    {
        return await _db.HeroSlides
            .Find(_ => true)
            .SortBy(s => s.SortOrder)
            .ThenBy(s => s.CreatedAt)
            .ToListAsync();
    }

    public async Task<HeroSlide?> GetByIdAsync(string id)
    {
        return await _db.HeroSlides.Find(s => s.Id == id).FirstOrDefaultAsync();
    }

    public async Task<HeroSlide> CreateAsync(HeroSlide slide)
    {
        slide.Id = null;
        slide.CreatedAt = DateTime.UtcNow;
        slide.UpdatedAt = DateTime.UtcNow;
        await _db.HeroSlides.InsertOneAsync(slide);
        return slide;
    }

    public async Task<HeroSlide?> UpdateAsync(string id, HeroSlide slide)
    {
        var existing = await GetByIdAsync(id);
        if (existing == null)
        {
            return null;
        }

        slide.Id = existing.Id;
        slide.CreatedAt = existing.CreatedAt;
        slide.UpdatedAt = DateTime.UtcNow;

        await _db.HeroSlides.ReplaceOneAsync(s => s.Id == id, slide);
        return slide;
    }

    public async Task<bool> DeleteAsync(string id)
    {
        var result = await _db.HeroSlides.DeleteOneAsync(s => s.Id == id);
        return result.DeletedCount > 0;
    }
}
