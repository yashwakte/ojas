using MongoDB.Driver;
using OjasApi.Models;

namespace OjasApi.Services;

/// <param name="IsServiceable">False when the pin sits outside the configured delivery radius.</param>
/// <param name="MaxRadiusKm">0 means no radius limit is configured.</param>
public record DeliveryQuote(
    double DistanceKm,
    decimal Charge,
    bool IsFree,
    bool IsServiceable,
    double MaxRadiusKm);

public class DeliveryChargesService
{
    private readonly IMongoDbService _db;

    public DeliveryChargesService(IMongoDbService db)
    {
        _db = db;
    }

    public async Task<DeliveryCharges?> GetAsync()
    {
        return await _db.DeliveryCharges.Find(_ => true).FirstOrDefaultAsync();
    }

    public async Task<DeliveryCharges> UpsertAsync(DeliveryCharges config)
    {
        config.UpdatedAt = DateTime.UtcNow;
        
        var existing = await GetAsync();
        if (existing == null)
        {
            config.CreatedAt = DateTime.UtcNow;
            await _db.DeliveryCharges.InsertOneAsync(config);
            return config;
        }

        config.Id = existing.Id;
        config.CreatedAt = existing.CreatedAt;
        
        await _db.DeliveryCharges.ReplaceOneAsync(c => c.Id == existing.Id, config);
        return config;
    }

    public async Task<DeliveryQuote> CalculateDeliveryChargeAsync(double latitude, double longitude)
    {
        var config = await GetAsync();
        if (config == null || !config.IsActive)
        {
            return new DeliveryQuote(0, 0, true, true, 0);
        }

        var distanceKm = CalculateDistanceKm(config.WarehouseLatitude, config.WarehouseLongitude, latitude, longitude);
        var maxRadiusKm = config.MaxDeliveryRadiusKm;
        var isServiceable = maxRadiusKm <= 0 || distanceKm <= maxRadiusKm;

        if (!isServiceable)
        {
            return new DeliveryQuote(distanceKm, 0, false, false, maxRadiusKm);
        }

        if (distanceKm <= config.FreeDeliveryUpToKm)
        {
            return new DeliveryQuote(distanceKm, 0, true, true, maxRadiusKm);
        }

        var chargeableKm = distanceKm - config.FreeDeliveryUpToKm;
        var charge = Math.Round((decimal)chargeableKm * config.PerKmChargeAfterFree, 2, MidpointRounding.AwayFromZero);
        return new DeliveryQuote(distanceKm, charge, false, true, maxRadiusKm);
    }

    // Haversine formula: great-circle distance between two lat/lng points, in kilometers.
    private static double CalculateDistanceKm(double lat1, double lon1, double lat2, double lon2)
    {
        const double earthRadiusKm = 6371;
        var dLat = ToRadians(lat2 - lat1);
        var dLon = ToRadians(lon2 - lon1);

        var a = Math.Sin(dLat / 2) * Math.Sin(dLat / 2) +
                Math.Cos(ToRadians(lat1)) * Math.Cos(ToRadians(lat2)) *
                Math.Sin(dLon / 2) * Math.Sin(dLon / 2);
        var c = 2 * Math.Atan2(Math.Sqrt(a), Math.Sqrt(1 - a));

        return earthRadiusKm * c;
    }

    private static double ToRadians(double degrees) => degrees * Math.PI / 180;
}