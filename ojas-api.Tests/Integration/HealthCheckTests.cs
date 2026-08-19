using System.Net;
using Shouldly;

namespace OjasApi.Tests.Integration;

/// <summary>
/// GET /health exists so Render (or any external monitor) can tell the difference between "the
/// process is up" and "the process is up but can't reach MongoDB" - the two look identical from
/// outside without this.
/// </summary>
[Collection(MongoCollectionFixture.Name)]
public class HealthCheckTests : IDisposable
{
    private readonly OjasApiFactory _factory;

    public HealthCheckTests(MongoRunnerFixture mongo)
    {
        _factory = new OjasApiFactory(mongo);
    }

    public void Dispose() => _factory.Dispose();

    [Fact]
    public async Task Health_ReturnsOk_WhenMongoIsReachable()
    {
        using var client = _factory.CreateClient();

        var response = await client.GetAsync("/health");

        response.StatusCode.ShouldBe(HttpStatusCode.OK);
        // ASP.NET Core's health check middleware writes this exact body when no custom response
        // writer is configured - asserting it (rather than just the status code) is what proves
        // this request actually reached the Mongo-backed check and not some other "/health" route.
        var body = await response.Content.ReadAsStringAsync();
        body.ShouldBe("Healthy");
    }

    [Fact]
    public async Task Health_RequiresNoAuthentication()
    {
        // A monitor pinging this has no session cookie and must not need one.
        using var client = _factory.CreateClient();

        var response = await client.GetAsync("/health");

        response.StatusCode.ShouldNotBe(HttpStatusCode.Unauthorized);
        response.StatusCode.ShouldNotBe(HttpStatusCode.Forbidden);
    }
}
