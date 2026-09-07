using System.Net;
using System.Net.Http.Json;
using OjasApi.Models;
using OjasApi.Services;
using Shouldly;

namespace OjasApi.Tests.Integration;

/// <summary>
/// The hero slides an admin manages from the console, exercised through the real pipeline -
/// routing, auth, roles and the CSRF check - rather than against the controller in isolation.
/// </summary>
[Collection(MongoCollectionFixture.Name)]
public class HeroSlideTests : IDisposable
{
    private readonly OjasApiFactory _factory;

    public HeroSlideTests(MongoRunnerFixture mongo)
    {
        _factory = new OjasApiFactory(mongo);
    }

    public void Dispose()
    {
        _factory.Dispose();
    }

    private static HttpRequestMessage Json(HttpMethod method, string url, object body, string csrf)
    {
        var request = new HttpRequestMessage(method, url) { Content = JsonContent.Create(body) };
        request.AttachCsrf(csrf);
        return request;
    }

    private static HeroSlide MakeSlide(string alt = "The fasting range") => new()
    {
        ImageUrl = "/api/media/poster.webp",
        AltText = alt,
        IsActive = true,
    };

    [Fact]
    public async Task AdminCreate_ThenPublicGetIncludesIt()
    {
        using var admin = _factory.CreateClient();
        var (_, csrf) = await _factory.SeedAndLoginAsStaffAsync(admin, UserRoles.Admin);

        var createResponse = await admin.SendAsync(Json(HttpMethod.Post, "/api/hero-slides", MakeSlide(), csrf));
        createResponse.StatusCode.ShouldBe(HttpStatusCode.OK);

        var created = await createResponse.Content.ReadFromJsonAsync<HeroSlide>();
        // The whole console depends on this: the admin can only edit or delete a slide it has an
        // id for, and the id it uses is the one this response hands back.
        created!.Id.ShouldNotBeNullOrWhiteSpace();

        using var publicClient = _factory.CreateClient();
        var fetched = await publicClient.GetFromJsonAsync<List<HeroSlide>>("/api/hero-slides");
        fetched!.ShouldContain(s => s.Id == created.Id);
    }

    [Fact]
    public async Task AdminUpdate_ThenAdminDelete_RemovesIt()
    {
        using var admin = _factory.CreateClient();
        var (_, csrf) = await _factory.SeedAndLoginAsStaffAsync(admin, UserRoles.Admin);

        var created = await admin.SendAsync(Json(HttpMethod.Post, "/api/hero-slides", MakeSlide("Original"), csrf));
        var slide = await created.Content.ReadFromJsonAsync<HeroSlide>();

        var updateResponse = await admin.SendAsync(
            Json(HttpMethod.Patch, $"/api/hero-slides/{slide!.Id}", MakeSlide("Updated"), csrf));
        updateResponse.StatusCode.ShouldBe(HttpStatusCode.OK);

        var updated = await updateResponse.Content.ReadFromJsonAsync<HeroSlide>();
        updated!.Id.ShouldBe(slide.Id);
        updated.AltText.ShouldBe("Updated");

        var deleteRequest = new HttpRequestMessage(HttpMethod.Delete, $"/api/hero-slides/{slide.Id}");
        deleteRequest.AttachCsrf(csrf);
        var deleteResponse = await admin.SendAsync(deleteRequest);
        deleteResponse.StatusCode.ShouldBe(HttpStatusCode.NoContent);

        using var publicClient = _factory.CreateClient();
        var fetched = await publicClient.GetFromJsonAsync<List<HeroSlide>>("/api/hero-slides");
        fetched!.ShouldNotContain(s => s.Id == slide.Id);
    }

    [Fact]
    public async Task Customer_ForbiddenFromCreate()
    {
        using var customerClient = _factory.CreateClient();
        var (_, csrf) = await customerClient.RegisterAsync();

        var response = await customerClient.SendAsync(Json(HttpMethod.Post, "/api/hero-slides", MakeSlide(), csrf));

        response.StatusCode.ShouldBe(HttpStatusCode.Forbidden);
    }
}
