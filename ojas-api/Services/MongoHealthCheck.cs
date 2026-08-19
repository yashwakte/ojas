using Microsoft.Extensions.Diagnostics.HealthChecks;
using MongoDB.Driver;

namespace OjasApi.Services;

/// <summary>
/// Confirms the API can actually reach MongoDB, not just that the process is running. A cheap,
/// already-indexed query rather than a raw ping command, so this doesn't need any surface added
/// to IMongoDbService beyond what already exists.
/// </summary>
public class MongoHealthCheck : IHealthCheck
{
    private readonly IMongoDbService _db;

    public MongoHealthCheck(IMongoDbService db)
    {
        _db = db;
    }

    public async Task<HealthCheckResult> CheckHealthAsync(
        HealthCheckContext context, CancellationToken cancellationToken = default)
    {
        try
        {
            await _db.Users.Find(Builders<Models.User>.Filter.Empty)
                .Limit(1)
                .AnyAsync(cancellationToken);
            return HealthCheckResult.Healthy("MongoDB reachable.");
        }
        catch (Exception ex)
        {
            return HealthCheckResult.Unhealthy("Could not reach MongoDB.", ex);
        }
    }
}
