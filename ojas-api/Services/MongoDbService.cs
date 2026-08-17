using Microsoft.Extensions.Options;
using MongoDB.Driver;
using OjasApi.Models;

namespace OjasApi.Services;

public class MongoDbService : IMongoDbService
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
    public IMongoCollection<DeliveryCharges> DeliveryCharges => _database.GetCollection<DeliveryCharges>("delivery_charges");
    public IMongoCollection<CampaignBanner> CampaignBanners => _database.GetCollection<CampaignBanner>("campaign_banner");
    public IMongoCollection<OtpCode> OtpCodes => _database.GetCollection<OtpCode>("otp_codes");

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

            // TTL index - Mongo automatically deletes an OTP document once ExpiresAt is in the
            // past, so the collection self-cleans instead of growing unbounded.
            var otpTtlIndex = new CreateIndexModel<OtpCode>(
                Builders<OtpCode>.IndexKeys.Ascending(o => o.ExpiresAt),
                new CreateIndexOptions { ExpireAfter = TimeSpan.Zero, Name = "otp_ttl" }
            );
            OtpCodes.Indexes.CreateOne(otpTtlIndex);
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
