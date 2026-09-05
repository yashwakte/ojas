using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using Microsoft.Extensions.DependencyInjection;
using MongoDB.Driver;
using OjasApi.Models;
using OjasApi.Services;
using Shouldly;

namespace OjasApi.Tests.Integration;

/// <summary>
/// The media endpoint exists so images stop travelling inside JSON responses. What matters is
/// not only that it stores and returns bytes, but that it returns them with a caching contract
/// strong enough that repeat traffic never reaches the origin at all - that is the whole
/// difference between a storefront that survives a busy evening and one that does not.
/// </summary>
[Collection(MongoCollectionFixture.Name)]
public class MediaTests : IDisposable
{
    private readonly OjasApiFactory _factory;

    public MediaTests(MongoRunnerFixture mongo)
    {
        _factory = new OjasApiFactory(mongo);
    }

    public void Dispose() => _factory.Dispose();

    // A genuine 2x3 PNG.
    private static readonly byte[] Png = Convert.FromBase64String(
        "iVBORw0KGgoAAAANSUhEUgAAAAIAAAADCAYAAABfmqDcAAAAFUlEQVR4nGP8z8DAwMDAxAADRDEAJKgB8Sd0F6EAAAAASUVORK5CYII=");

    private static MultipartFormDataContent Upload(byte[] bytes, string fileName, string contentType)
    {
        var content = new ByteArrayContent(bytes);
        content.Headers.ContentType = new MediaTypeHeaderValue(contentType);
        return new MultipartFormDataContent { { content, "file", fileName } };
    }

    private sealed record UploadResponse(string Url, int Width, int Height);

    private async Task<(HttpClient Client, string Url)> UploadAsAdminAsync(byte[] bytes)
    {
        var client = _factory.CreateClient();
        var (_, csrf) = await _factory.SeedAndLoginAsStaffAsync(client, UserRoles.Admin);

        var request = new HttpRequestMessage(HttpMethod.Post, "/api/media") { Content = Upload(bytes, "art.png", "image/png") };
        request.AttachCsrf(csrf);

        var response = await client.SendAsync(request);
        response.StatusCode.ShouldBe(HttpStatusCode.OK);

        var body = await response.Content.ReadFromJsonAsync<UploadResponse>();
        body.ShouldNotBeNull();
        return (client, body.Url);
    }

    [Fact]
    public async Task Upload_ThenGet_ReturnsTheExactBytesWithAnImmutableCachingContract()
    {
        var (client, url) = await UploadAsAdminAsync(Png);

        url.ShouldStartWith("/api/media/");
        url.ShouldEndWith(".png");

        using var anonymous = _factory.CreateClient();
        var response = await anonymous.GetAsync(url);

        response.StatusCode.ShouldBe(HttpStatusCode.OK);
        (await response.Content.ReadAsByteArrayAsync()).ShouldBe(Png);
        response.Content.Headers.ContentType!.MediaType.ShouldBe("image/png");

        // A year, marked immutable. This is only safe because the URL is the hash of the bytes,
        // so an edited picture is necessarily a different URL and can never be masked by a cache.
        var cacheControl = response.Headers.CacheControl!;
        cacheControl.Public.ShouldBeTrue();
        cacheControl.MaxAge.ShouldBe(TimeSpan.FromDays(365));
        cacheControl.ToString().ShouldContain("immutable");
        response.Headers.ETag.ShouldNotBeNull();

        client.Dispose();
    }

    [Fact]
    public async Task Get_WithMatchingETag_Returns304AndNoBody()
    {
        var (client, url) = await UploadAsAdminAsync(Png);

        using var anonymous = _factory.CreateClient();
        var first = await anonymous.GetAsync(url);
        var etag = first.Headers.ETag!;

        var conditional = new HttpRequestMessage(HttpMethod.Get, url);
        conditional.Headers.IfNoneMatch.Add(etag);
        var second = await anonymous.SendAsync(conditional);

        // Caches that ignore `immutable`, and users who force-reload, still get the cheap answer.
        second.StatusCode.ShouldBe(HttpStatusCode.NotModified);
        (await second.Content.ReadAsByteArrayAsync()).ShouldBeEmpty();

        client.Dispose();
    }

    [Fact]
    public async Task Get_UnknownOrMalformedKey_Is404()
    {
        using var client = _factory.CreateClient();

        (await client.GetAsync($"/api/media/{new string('a', 64)}.webp")).StatusCode.ShouldBe(HttpStatusCode.NotFound);
        // Anything that is not a 64-character lowercase hex hash is rejected before it reaches
        // the database, so the endpoint cannot be used to probe it.
        (await client.GetAsync("/api/media/short.webp")).StatusCode.ShouldBe(HttpStatusCode.NotFound);
        (await client.GetAsync("/api/media/NOTHEXNOTHEXNOTHEXNOTHEXNOTHEXNOTHEXNOTHEXNOTHEXNOTHEXNOTHEXABCD.webp"))
            .StatusCode.ShouldBe(HttpStatusCode.NotFound);
    }

    [Fact]
    public async Task Upload_TheSameImageTwice_StoresItOnceAndReturnsTheSameUrl()
    {
        var (first, urlA) = await UploadAsAdminAsync(Png);
        var (second, urlB) = await UploadAsAdminAsync(Png);

        urlB.ShouldBe(urlA);
        (await CountAssetsAsync()).ShouldBe(1);

        first.Dispose();
        second.Dispose();
    }

    [Fact]
    public async Task Upload_RefusesAFileThatIsNotReallyAnImage()
    {
        using var client = _factory.CreateClient();
        var (_, csrf) = await _factory.SeedAndLoginAsStaffAsync(client, UserRoles.Admin);

        // Declared image/png, actually HTML. Serving this back from our own origin is exactly
        // what the byte-level check exists to prevent.
        var html = System.Text.Encoding.UTF8.GetBytes("<html><script>alert(1)</script></html>");
        var request = new HttpRequestMessage(HttpMethod.Post, "/api/media") { Content = Upload(html, "art.png", "image/png") };
        request.AttachCsrf(csrf);

        var response = await client.SendAsync(request);

        response.StatusCode.ShouldBe(HttpStatusCode.BadRequest);
        (await CountAssetsAsync()).ShouldBe(0);
    }

    [Fact]
    public async Task Upload_RequiresAnAdmin()
    {
        using var anonymous = _factory.CreateClient();
        var response = await anonymous.PostAsync("/api/media", Upload(Png, "art.png", "image/png"));
        response.StatusCode.ShouldBeOneOf(HttpStatusCode.Unauthorized, HttpStatusCode.Forbidden);

        (await CountAssetsAsync()).ShouldBe(0);
    }

    [Fact]
    public async Task CampaignBanners_AreServedWithAPublicCacheHeaderForAnonymousVisitors()
    {
        using var client = _factory.CreateClient();

        var response = await client.GetAsync("/api/campaign-banner");

        response.StatusCode.ShouldBe(HttpStatusCode.OK);
        response.Headers.CacheControl!.Public.ShouldBeTrue();
        response.Headers.CacheControl.ToString().ShouldContain("stale-while-revalidate");
    }

    [Fact]
    public async Task Catalog_IsNeverPubliclyCachedForASignedInCaller()
    {
        using var client = _factory.CreateClient();
        await client.RegisterAsync();

        var response = await client.GetAsync("/api/products");

        // An authenticated response names the caller's account in X-Ojas-User. A shared cache
        // storing one of those would serve one customer's identity to the next visitor, so it is
        // marked private - which is the directive that keeps it out of every cache except the
        // customer's own browser.
        response.StatusCode.ShouldBe(HttpStatusCode.OK);
        response.Headers.CacheControl!.Public.ShouldBeFalse();
        response.Headers.CacheControl.Private.ShouldBeTrue();

        // ...and their own browser is explicitly allowed to keep it. Forbidding that too bought no
        // privacy and made every catalogue read of a signed-in customer - the ones who browse most
        // - travel all the way to the API.
        response.Headers.CacheControl.NoStore.ShouldBeFalse();
        response.Headers.CacheControl.MaxAge.ShouldNotBeNull();
    }

    [Fact]
    public async Task Catalog_IsNotCachedAtAllForAnAdmin()
    {
        using var client = _factory.CreateClient();
        await _factory.SeedAndLoginAsStaffAsync(client, UserRoles.Admin);

        var response = await client.GetAsync("/api/products");

        // The admin is the caller who edits the catalogue and judges a save by what the list
        // shows immediately afterwards. If their browser may keep this response, the re-fetch
        // that follows a save is answered with the pre-save body and a correct write looks like
        // it was silently discarded.
        response.StatusCode.ShouldBe(HttpStatusCode.OK);
        response.Headers.CacheControl!.NoStore.ShouldBeTrue();
        response.Headers.CacheControl.Public.ShouldBeFalse();
        response.Headers.CacheControl.MaxAge.ShouldBeNull();
    }

    [Fact]
    public async Task MigrateDataUrl_MovesAnInlineBase64ImageIntoTheStoreAndIsSafeToRerun()
    {
        var media = _factory.Services.GetRequiredService<MediaService>();

        var dataUrl = "data:image/png;base64," + Convert.ToBase64String(Png);
        var url = await media.MigrateDataUrlAsync(dataUrl);

        url.ShouldStartWith("/api/media/");
        (await CountAssetsAsync()).ShouldBe(1);

        // Re-running finds a URL rather than a data: string and leaves it alone, which is what
        // makes the startup migration safe to run on every boot.
        (await media.MigrateDataUrlAsync(url)).ShouldBe(url);
        (await CountAssetsAsync()).ShouldBe(1);
    }

    [Fact]
    public async Task StartupMigration_RewritesABannerThatStillHoldsAnInlineImage()
    {
        await _factory.SeedAsync(async db =>
        {
            await db.CampaignBanners.InsertOneAsync(new CampaignBanner
            {
                Title = "Janmashtami",
                BackgroundImageUrl = "data:image/png;base64," + Convert.ToBase64String(Png),
                IsActive = true,
            });
        });

        await _factory.Services.GetRequiredService<MediaMigrationService>().RunAsync();

        await _factory.SeedAsync(async db =>
        {
            var banner = await db.CampaignBanners.Find(FilterDefinition<CampaignBanner>.Empty).FirstAsync();
            banner.BackgroundImageUrl.ShouldStartWith("/api/media/");
        });
    }

    private async Task<long> CountAssetsAsync()
    {
        long count = 0;
        await _factory.SeedAsync(async db =>
        {
            count = await db.MediaAssets.CountDocumentsAsync(FilterDefinition<MediaAsset>.Empty);
        });
        return count;
    }
}
