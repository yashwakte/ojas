using MongoDB.Driver;
using OjasApi.Models;

namespace OjasApi.Services;

/// <param name="IsServiceable">False when we don't deliver to this address.</param>
/// <param name="MaxRadiusKm">0 means no radius limit is configured. Only meaningful in the older
/// distance-based mode; pincode pricing has no radius.</param>
/// <param name="PricedByPincode">True when the charge came from the admin's serviceable-pincode
/// list rather than from a map pin. The distinction matters because only one of those two is
/// safe from a browser that lies about where it is.</param>
public record DeliveryQuote(
    double DistanceKm,
    decimal Charge,
    bool IsFree,
    bool IsServiceable,
    double MaxRadiusKm,
    bool PricedByPincode = false);

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

    /// <summary>
    /// Pulls the six-digit pincode out of a free-text address. Returns null when the address
    /// doesn't state one, which is itself a reason to refuse an order once pincode pricing is
    /// configured.
    ///
    /// Takes the *last* standalone six-digit run, because that is where Indian addresses put the
    /// pincode - and because taking the first would happily match the middle of a phone number
    /// written into the address line. The word boundaries matter for the same reason: a ten-digit
    /// mobile number contains a six-digit substring but no six-digit token.
    /// </summary>
    public static string? PincodeFrom(string? address)
    {
        if (string.IsNullOrWhiteSpace(address))
            return null;

        var matches = PincodePattern.Matches(address);
        return matches.Count > 0 ? matches[^1].Groups[1].Value : null;
    }

    private static readonly System.Text.RegularExpressions.Regex PincodePattern =
        new(@"\b(\d{6})\b", System.Text.RegularExpressions.RegexOptions.Compiled,
            TimeSpan.FromMilliseconds(100));

    /// <summary>
    /// What delivery costs, and whether we deliver there at all.
    ///
    /// Once serviceable pincodes are configured they are the whole answer, and the coordinates
    /// are ignored: they come from the browser, so anything priced off them can be priced to zero
    /// by a crafted request claiming to be standing in the warehouse. The pin stays useful for
    /// the delivery partner's navigation — it just no longer moves money.
    /// </summary>
    public async Task<DeliveryQuote> CalculateDeliveryChargeAsync(
        double latitude, double longitude, string? pincode = null)
    {
        var config = await GetAsync();
        if (config == null || !config.IsActive)
        {
            return new DeliveryQuote(0, 0, true, true, 0);
        }

        if (config.ChargesByPincode)
            return QuoteByPincode(config, pincode, latitude, longitude);

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

    private static DeliveryQuote QuoteByPincode(
        DeliveryCharges config, string? pincode, double latitude, double longitude)
    {
        // Kept purely so the admin and delivery partner can still see how far it is; it plays no
        // part in what is charged.
        var distanceKm = CalculateDistanceKm(
            config.WarehouseLatitude, config.WarehouseLongitude, latitude, longitude);

        var area = pincode is null
            ? null
            : config.ServiceableAreas.FirstOrDefault(
                a => string.Equals(a.Pincode, pincode, StringComparison.Ordinal));

        if (area is null)
            return new DeliveryQuote(distanceKm, 0, false, false, config.MaxDeliveryRadiusKm, true);

        var charge = area.Charge ?? config.DefaultDeliveryCharge;
        return new DeliveryQuote(
            distanceKm,
            Math.Round(charge, 2, MidpointRounding.AwayFromZero),
            charge <= 0,
            true,
            config.MaxDeliveryRadiusKm,
            true);
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