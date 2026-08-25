using Moq;
using MongoDB.Bson;
using MongoDB.Driver;

namespace OjasApi.Tests.TestHelpers;

/// <summary>
/// MongoDB.Driver's LINQ-ish query surface (Find(...).ToListAsync() etc.) is built from extension
/// methods over IAsyncCursorSource, which Moq cannot intercept directly. These helpers mock the
/// underlying IAsyncCursor/ToCursorAsync plumbing so that Find(...).ToListAsync()/FirstOrDefaultAsync()/
/// AnyAsync() work against an in-memory list on a mocked IMongoCollection&lt;T&gt;.
///
/// Because the mock does not evaluate the filter expression, SetupFind always returns the full
/// `data` list regardless of the filter passed by the code under test. Use this to unit-test service
/// logic built around the query result (mapping, merging, branching) — use the Mongo2Go-backed
/// integration tests to verify that filters actually select the right documents.
/// </summary>
public static class MongoCollectionMockExtensions
{
    public static Mock<IAsyncCursor<T>> ToMockCursor<T>(this IEnumerable<T> items)
    {
        var list = items.ToList();
        var mockCursor = new Mock<IAsyncCursor<T>>();
        mockCursor.Setup(c => c.Current).Returns(list);
        mockCursor
            .SetupSequence(c => c.MoveNext(It.IsAny<CancellationToken>()))
            .Returns(true)
            .Returns(false);
        mockCursor
            .SetupSequence(c => c.MoveNextAsync(It.IsAny<CancellationToken>()))
            .ReturnsAsync(true)
            .ReturnsAsync(false);
        return mockCursor;
    }

    /// <summary>
    /// Makes `collection.Find(...)` (any filter, with or without .Sort()/.Limit()) return the given
    /// data set. `Find()` itself is an extension method that Moq cannot intercept - but it's a thin
    /// wrapper that funnels down to the real interface method IMongoCollection.FindAsync when the
    /// fluent chain is finally awaited (ToListAsync/FirstOrDefaultAsync/AnyAsync all resolve to it),
    /// so mocking FindAsync is sufficient to make the whole chain return this data regardless of
    /// which fluent filtering/sorting/limiting methods were called along the way.
    /// </summary>
    /// <summary>
    /// Makes `collection.FindOneAndUpdateAsync(...)` return <paramref name="claimed"/> - the
    /// document as it was *before* the update, which is what the driver returns by default, and
    /// null when the conditional filter matched nothing.
    ///
    /// AuthService.RefreshAsync uses exactly that null/non-null answer to decide whether this
    /// caller won the race to rotate a refresh token, so a mocked collection has to be told
    /// which side of that race it is on. Left unset, Moq's loose default is null, which would
    /// silently put every test on the "someone else rotated it" path.
    /// </summary>
    public static void SetupRotationClaim<TDocument>(
        this Mock<IMongoCollection<TDocument>> mockCollection,
        TDocument? claimed)
    {
        mockCollection
            .Setup(c => c.FindOneAndUpdateAsync(
                It.IsAny<FilterDefinition<TDocument>>(),
                It.IsAny<UpdateDefinition<TDocument>>(),
                It.IsAny<FindOneAndUpdateOptions<TDocument, TDocument>>(),
                It.IsAny<CancellationToken>()))
            .ReturnsAsync(claimed!);
    }

    public static void SetupFind<TDocument>(this Mock<IMongoCollection<TDocument>> mockCollection, List<TDocument> data)
    {
        // A cursor's MoveNext/MoveNextAsync sequence is single-use (it's consumed once as it's iterated),
        // but the code under test may legitimately call Find(...) more than once against the same mocked
        // collection within a single test (e.g. a controller re-fetching a document that its own service
        // call also fetches internally). Binding a single captured cursor instance via ReturnsAsync(value)
        // means the second call would reuse an already-exhausted cursor and silently look empty. Using the
        // Func<> overload of ReturnsAsync makes Moq invoke the factory fresh on every matching call, so
        // each Find(...) gets its own unconsumed cursor over the same backing `data`.
        mockCollection
            .Setup(c => c.FindAsync(
                It.IsAny<FilterDefinition<TDocument>>(),
                It.IsAny<FindOptions<TDocument, TDocument>>(),
                It.IsAny<CancellationToken>()))
            .ReturnsAsync(() => data.ToMockCursor().Object);

        // `.AnyAsync()` on the fluent Find() chain doesn't reuse the FindAsync<TDocument> overload above -
        // internally it projects to FindAsync<BsonDocument>(filter, FindOptions<TDocument, BsonDocument>, ct)
        // to avoid fetching full documents just to check existence. Without mocking this overload too, Moq's
        // loose-mock default returns a Task wrapping a null cursor, and the driver's GetFirstBatchAsync then
        // NullReferenceExceptions calling MoveNextAsync() on it. One dummy (empty) BsonDocument is enough to
        // make `.Any()` true/false match whether `data` is non-empty - AnyAsync only checks batch presence.
        mockCollection
            .Setup(c => c.FindAsync(
                It.IsAny<FilterDefinition<TDocument>>(),
                It.IsAny<FindOptions<TDocument, BsonDocument>>(),
                It.IsAny<CancellationToken>()))
            .ReturnsAsync(() => (data.Count > 0 ? new List<BsonDocument> { new() } : []).ToMockCursor().Object);
    }
}
