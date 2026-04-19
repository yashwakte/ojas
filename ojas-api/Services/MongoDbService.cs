using Microsoft.Extensions.Options;
using MongoDB.Driver;
using OjasApi.Models;

namespace OjasApi.Services;

public class MongoDbService
{
    private readonly IMongoDatabase _database;
    private readonly ILogger<MongoDbService> _logger;

    public MongoDbService(IOptions<MongoDbSettings> settings, ILogger<MongoDbService> logger)
    {
        _logger = logger;
        var mongoSettings = MongoClientSettings.FromConnectionString(settings.Value.ConnectionString);
        mongoSettings.ConnectTimeout = TimeSpan.FromSeconds(30);
        mongoSettings.ServerSelectionTimeout = TimeSpan.FromSeconds(30);
        var client = new MongoClient(mongoSettings);
        _database = client.GetDatabase(settings.Value.DatabaseName);

        TryEnsureIndexes();
    }

    public IMongoCollection<Product> Products => _database.GetCollection<Product>("products");
    public IMongoCollection<User> Users => _database.GetCollection<User>("users");
    public IMongoCollection<Order> Orders => _database.GetCollection<Order>("orders");

    private void TryEnsureIndexes()
    {
        try
        {
            var emailIndex = new CreateIndexModel<User>(
                Builders<User>.IndexKeys.Ascending(u => u.Email),
                new CreateIndexOptions { Unique = true, Name = "unique_email" }
            );
            var phoneIndex = new CreateIndexModel<User>(
                Builders<User>.IndexKeys.Ascending(u => u.Phone),
                new CreateIndexOptions { Unique = true, Name = "unique_phone" }
            );
            Users.Indexes.CreateMany([emailIndex, phoneIndex]);
        }
        catch (MongoCommandException ex)
        {
            _logger.LogWarning(
                "Could not create unique indexes on users collection: {Message}. " +
                "Remove duplicate email/phone entries from the database to enforce uniqueness.",
                ex.Message);
        }
    }
}
