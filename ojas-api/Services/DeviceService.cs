using System.Security.Cryptography;
using System.Text;
using MongoDB.Driver;
using OjasApi.Models;

namespace OjasApi.Services;

/// <summary>
/// Owns the "a staff account may only sign in from one device" rule: issuing device ids,
/// checking a presented one, and replacing the bound device when a staff member moves to a
/// new phone or laptop.
/// </summary>
public class DeviceService
{
    private readonly IMongoDbService _db;

    public DeviceService(IMongoDbService db)
    {
        _db = db;
    }

    /// <summary>Customers are deliberately exempt - device restriction exists to protect the
    /// accounts that can see every order and every customer address.</summary>
    public static bool IsRestrictedRole(string? role) =>
        role is UserRoles.Admin or UserRoles.Delivery;

    public static string HashDeviceId(string rawDeviceId) =>
        Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(rawDeviceId)));

    public static string GenerateRawDeviceId() =>
        Convert.ToHexString(RandomNumberGenerator.GetBytes(32));

    /// <summary>True when this exact device is the one currently bound to the account. Also
    /// refreshes lastSeenAt so the admin UI can show when a device was last used.</summary>
    public async Task<bool> IsDeviceTrustedAsync(string userId, string? rawDeviceId)
    {
        if (string.IsNullOrWhiteSpace(rawDeviceId))
            return false;

        var hash = HashDeviceId(rawDeviceId);
        var device = await _db.StaffDevices
            .Find(d => d.DeviceIdHash == hash && d.UserId == userId)
            .FirstOrDefaultAsync();

        if (device == null)
            return false;

        await _db.StaffDevices.UpdateOneAsync(
            Builders<StaffDevice>.Filter.Eq(d => d.DeviceIdHash, hash),
            Builders<StaffDevice>.Update.Set(d => d.LastSeenAt, DateTime.UtcNow));

        return true;
    }

    /// <summary>
    /// Binds this browser to the account and returns the raw device id for the caller to set as
    /// a cookie. Because the cap is one device per person, this *replaces* the user's previous
    /// binding and revokes their refresh tokens, so approving a new device immediately logs
    /// their old one out.
    ///
    /// The browser's existing device id is reused when it presents one we already issued, so a
    /// shop computer shared by an admin and a delivery partner doesn't make the two accounts
    /// evict each other from the single device cookie - each approves once and both stay
    /// trusted. An unrecognised id is never adopted, only a freshly generated one: otherwise a
    /// value planted in the browser could be fixed in place and would then be a valid device id
    /// for whoever enrolled next.
    /// </summary>
    public async Task<string> EnrollDeviceAsync(
        string userId, string label, string enrolledVia, string? presentedRawDeviceId)
    {
        // Checked before the user's own rows are cleared, so re-approving the only device
        // currently bound to this account still counts as a device we recognise.
        var rawDeviceId = await IsKnownDeviceAsync(presentedRawDeviceId)
            ? presentedRawDeviceId!
            : GenerateRawDeviceId();

        await RevokeAllDevicesForUserAsync(userId);

        await _db.StaffDevices.InsertOneAsync(new StaffDevice
        {
            DeviceIdHash = HashDeviceId(rawDeviceId),
            UserId = userId,
            Label = label,
            EnrolledVia = enrolledVia,
        });

        return rawDeviceId;
    }

    /// <summary>True when this device id is already bound to somebody - i.e. the server issued
    /// it at some point, rather than it being an arbitrary value supplied by the client.</summary>
    private async Task<bool> IsKnownDeviceAsync(string? rawDeviceId)
    {
        if (string.IsNullOrWhiteSpace(rawDeviceId))
            return false;

        var hash = HashDeviceId(rawDeviceId);
        return await _db.StaffDevices.Find(d => d.DeviceIdHash == hash).AnyAsync();
    }

    public async Task<List<StaffDevice>> GetDevicesForUserAsync(string userId) =>
        await _db.StaffDevices.Find(d => d.UserId == userId).ToListAsync();

    /// <summary>Removes the binding and kills every session it was holding open. Used both by
    /// the admin "revoke" action and internally when a device is replaced.</summary>
    public async Task RevokeAllDevicesForUserAsync(string userId)
    {
        await _db.StaffDevices.DeleteManyAsync(d => d.UserId == userId);
        await _db.RefreshTokens.DeleteManyAsync(r => r.UserId == userId);
    }

    /// <summary>Best-effort friendly name from the User-Agent, purely so the admin UI shows
    /// "Chrome on Android" instead of an opaque hash. Never used for any security decision -
    /// it's cosmetic, and a client can put whatever it likes in this header.</summary>
    public static string DescribeDevice(string? userAgent)
    {
        if (string.IsNullOrWhiteSpace(userAgent))
            return "Unknown device";

        var browser =
            userAgent.Contains("Edg/", StringComparison.OrdinalIgnoreCase) ? "Edge" :
            userAgent.Contains("OPR/", StringComparison.OrdinalIgnoreCase) ? "Opera" :
            userAgent.Contains("Firefox", StringComparison.OrdinalIgnoreCase) ? "Firefox" :
            userAgent.Contains("Chrome", StringComparison.OrdinalIgnoreCase) ? "Chrome" :
            userAgent.Contains("Safari", StringComparison.OrdinalIgnoreCase) ? "Safari" :
            "Browser";

        var os =
            userAgent.Contains("Android", StringComparison.OrdinalIgnoreCase) ? "Android" :
            userAgent.Contains("iPhone", StringComparison.OrdinalIgnoreCase) ? "iPhone" :
            userAgent.Contains("iPad", StringComparison.OrdinalIgnoreCase) ? "iPad" :
            userAgent.Contains("Windows", StringComparison.OrdinalIgnoreCase) ? "Windows" :
            userAgent.Contains("Mac OS", StringComparison.OrdinalIgnoreCase) ? "macOS" :
            userAgent.Contains("Linux", StringComparison.OrdinalIgnoreCase) ? "Linux" :
            "device";

        return $"{browser} on {os}";
    }
}
