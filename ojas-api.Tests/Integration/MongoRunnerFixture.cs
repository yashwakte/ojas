using Mongo2Go;

namespace OjasApi.Tests.Integration;

/// <summary>
/// Starts a single embedded MongoDB instance (via Mongo2Go) for the whole test run, since spinning
/// up mongod per test/class is slow. Individual test classes each get their own database name
/// (see OjasApiFactory) on top of this shared instance, so data never leaks between test classes.
/// </summary>
public sealed class MongoRunnerFixture : IDisposable
{
    public MongoDbRunner Runner { get; }

    public MongoRunnerFixture()
    {
        Runner = MongoDbRunner.Start(singleNodeReplSet: false);
    }

    public void Dispose()
    {
        Runner.Dispose();
    }
}

[CollectionDefinition(Name)]
public sealed class MongoCollectionFixture : ICollectionFixture<MongoRunnerFixture>
{
    public const string Name = "Mongo2Go collection";
}
