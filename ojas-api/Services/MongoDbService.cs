using Microsoft.Extensions.Options;
using MongoDB.Driver;
using OjasApi.Models;

namespace OjasApi.Services;

public class MongoDbService
{
    private readonly IMongoDatabase _database;

    public MongoDbService(IOptions<MongoDbSettings> settings)
    {
        var mongoSettings = MongoClientSettings.FromConnectionString(settings.Value.ConnectionString);
        mongoSettings.ConnectTimeout = TimeSpan.FromSeconds(30);
        mongoSettings.ServerSelectionTimeout = TimeSpan.FromSeconds(30);
        var client = new MongoClient(mongoSettings);
        _database = client.GetDatabase(settings.Value.DatabaseName);
    }

    public IMongoCollection<Product> Products => _database.GetCollection<Product>("products");
    public IMongoCollection<User> Users => _database.GetCollection<User>("users");
    public IMongoCollection<Order> Orders => _database.GetCollection<Order>("orders");
}
