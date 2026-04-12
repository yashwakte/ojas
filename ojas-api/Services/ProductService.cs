using MongoDB.Driver;
using OjasApi.Models;

namespace OjasApi.Services;

public class ProductService
{
    private readonly MongoDbService _db;

    public ProductService(MongoDbService db)
    {
        _db = db;
    }

    public async Task<List<Product>> GetAllAsync() =>
        await _db.Products.Find(_ => true).ToListAsync();

    public async Task<Product?> GetByIdAsync(string id) =>
        await _db.Products.Find(p => p.Id == id).FirstOrDefaultAsync();

    public async Task<List<Product>> GetByCategoryAsync(string category) =>
        await _db.Products.Find(p => p.Category == category).ToListAsync();

    public async Task CreateAsync(Product product) =>
        await _db.Products.InsertOneAsync(product);

    public async Task SeedAsync(List<Product> products)
    {
        var count = await _db.Products.CountDocumentsAsync(_ => true);
        if (count == 0)
        {
            await _db.Products.InsertManyAsync(products);
        }
    }
}
