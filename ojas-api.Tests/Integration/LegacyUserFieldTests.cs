using MongoDB.Bson;
using MongoDB.Driver;
using OjasApi.Models;
using Shouldly;

namespace OjasApi.Tests.Integration;

/// <summary>
/// The MongoDB C# driver serializes every mapped property, nulls included, so documents written
/// while a property existed keep that field forever. Removing the property from the model then
/// makes those stored documents unreadable - the driver throws on an element it can't map.
///
/// User.RegisteredDeviceId was removed when staff device bindings moved to their own collection,
/// which is exactly this situation for every account created before that change.
/// </summary>
[Collection(MongoCollectionFixture.Name)]
public class LegacyUserFieldTests : IDisposable
{
    private readonly OjasApiFactory _factory;

    public LegacyUserFieldTests(MongoRunnerFixture mongo)
    {
        _factory = new OjasApiFactory(mongo);
    }

    public void Dispose() => _factory.Dispose();

    [Fact]
    public async Task AUserDocument_WithTheRetiredRegisteredDeviceIdField_StillDeserializes()
    {
        await _factory.SeedAsync(async db =>
        {
            // Written the way the driver would have written it back when User still mapped the
            // property - a plain null field sitting alongside the live ones.
            var legacy = new BsonDocument
            {
                { "fullName", "Legacy Admin" },
                { "email", "legacy.admin@example.com" },
                { "phone", "9000000001" },
                { "passwordHash", BCrypt.Net.BCrypt.HashPassword("Passw0rd123!") },
                { "role", UserRoles.Admin },
                { "isEmailVerified", true },
                { "isPhoneVerified", true },
                { "registeredDeviceId", BsonNull.Value },
                { "createdAt", DateTime.UtcNow },
                { "savedAddresses", new BsonArray() },
            };

            var rawCollection = db.Users.Database.GetCollection<BsonDocument>("users");
            await rawCollection.InsertOneAsync(legacy);
        });

        // Any read of the users collection - logging in, listing delivery partners, resolving a
        // role - goes through this same deserialization path.
        await _factory.SeedAsync(async db =>
        {
            var user = await db.Users.Find(u => u.Email == "legacy.admin@example.com").FirstOrDefaultAsync();

            user.ShouldNotBeNull();
            user!.FullName.ShouldBe("Legacy Admin");
            user.Role.ShouldBe(UserRoles.Admin);
        });
    }
}
