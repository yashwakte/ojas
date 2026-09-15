using MongoDB.Bson;
using MongoDB.Bson.Serialization;
using OjasApi.Models;
using Shouldly;

namespace OjasApi.Tests.Services;

/// <summary>
/// A product document must stay readable by an API build that does not know one of its fields.
/// Otherwise a field added in one release takes the whole catalogue down for any older build
/// still reading the same database — a rollback, or a copy run locally against production.
/// </summary>
public class ProductSerializationTests
{
    private static BsonDocument ProductDocument() => new()
    {
        { "_id", ObjectId.GenerateNewId() },
        { "name", "Modak Pith" },
        { "description", "Ready-to-use modak pith" },
        { "price", 65 },
        { "category", "Traditional & Festive" },
        { "weight", "500g" },
    };

    [Fact]
    public void ReadsAProduct_CarryingAFieldThisBuildDoesNotKnow()
    {
        var document = ProductDocument();
        document.Add("fieldFromALaterRelease", "anything");

        var product = BsonSerializer.Deserialize<Product>(document);

        product.Name.ShouldBe("Modak Pith");
    }
}
