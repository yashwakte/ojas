using MongoDB.Driver;
using OjasApi.Models;

namespace OjasApi.Services;

public class DeliveryChargesService
{
    private readonly MongoDbService _db;

    public DeliveryChargesService(MongoDbService db)
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

    public async Task<(double DistanceKm, decimal Charge, bool IsFree)> CalculateDeliveryChargeAsync(double latitude, double longitude)
    {
        var config = await GetAsync();
        if (config == null || !config.IsActive)
        {
            return (0, 0, true);
        }

        var distanceKm = CalculateDistanceKm(config.WarehouseLatitude, config.WarehouseLongitude, latitude, longitude);

        if (distanceKm <= config.FreeDeliveryUpToKm)
        {
            return (distanceKm, 0, true);
        }

        var chargeableKm = distanceKm - config.FreeDeliveryUpToKm;
        var charge = Math.Round((decimal)chargeableKm * config.PerKmChargeAfterFree, 2, MidpointRounding.AwayFromZero);
        return (distanceKm, charge, false);
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