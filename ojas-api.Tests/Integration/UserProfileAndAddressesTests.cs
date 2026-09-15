using System.Net;
using System.Net.Http.Json;
using OjasApi.Models;
using Shouldly;

namespace OjasApi.Tests.Integration;

[Collection(MongoCollectionFixture.Name)]
public class UserProfileAndAddressesTests : IDisposable
{
    private readonly OjasApiFactory _factory;

    public UserProfileAndAddressesTests(MongoRunnerFixture mongo)
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

    [Fact]
    public async Task UpdateProfile_Success_PersistsTheNewName()
    {
        using var client = _factory.CreateClient();
        var (auth, csrf) = await client.RegisterAsync();

        var request = new UpdateProfileRequest("Updated Name");

        var response = await client.SendAsync(Json(HttpMethod.Put, "/api/user/profile", request, csrf));

        response.StatusCode.ShouldBe(HttpStatusCode.NoContent);

        var profileResponse = await client.GetAsync("/api/user/profile");
        var profile = await profileResponse.Content.ReadFromJsonAsync<UserProfileResponse>();
        profile!.FullName.ShouldBe("Updated Name");
        profile.Email.ShouldBe(auth.Email);
    }

    /// <summary>Registration proves the phone and leaves the email unproved, and the profile
    /// screen needs to be able to say so - otherwise it cannot show the Verify button that is a
    /// customer's only route to confirming their address after signup.</summary>
    [Fact]
    public async Task GetProfile_ReportsWhichContactDetailsHaveBeenVerified()
    {
        using var client = _factory.CreateClient();
        await client.RegisterAsync();

        var profileResponse = await client.GetAsync("/api/user/profile");
        var profile = await profileResponse.Content.ReadFromJsonAsync<UserProfileResponse>();

        profile!.IsPhoneVerified.ShouldBeTrue();
        profile.IsEmailVerified.ShouldBeFalse();
    }

    /// <summary>The trick the profile form used to allow: verify a number you own at signup, then
    /// type any other number into the form. A copy of the site loaded before the fix still sends
    /// the field, so the refusal has to be the server's, not just the form's.</summary>
    [Fact]
    public async Task UpdateProfile_RefusesToChangeThePhone_AndKeepsTheVerifiedOne()
    {
        using var client = _factory.CreateClient();
        var (auth, csrf) = await client.RegisterAsync();

        var differentPhone = $"9{Math.Abs(Guid.NewGuid().GetHashCode()).ToString().PadLeft(9, '0')[..9]}";
        var request = new UpdateProfileRequest(auth.FullName, auth.Email, differentPhone);

        var response = await client.SendAsync(Json(HttpMethod.Put, "/api/user/profile", request, csrf));
        response.StatusCode.ShouldBe(HttpStatusCode.BadRequest);

        var profile = await (await client.GetAsync("/api/user/profile"))
            .Content.ReadFromJsonAsync<UserProfileResponse>();
        profile!.Phone.ShouldBe(auth.Phone);
        profile.IsPhoneVerified.ShouldBeTrue();
    }

    [Fact]
    public async Task UpdateProfile_RefusesToChangeTheEmail()
    {
        using var client = _factory.CreateClient();
        var (auth, csrf) = await client.RegisterAsync();

        var request = new UpdateProfileRequest(auth.FullName, $"changed.{Guid.NewGuid():N}@example.com", auth.Phone);
        var response = await client.SendAsync(Json(HttpMethod.Put, "/api/user/profile", request, csrf));
        response.StatusCode.ShouldBe(HttpStatusCode.BadRequest);

        var profile = await (await client.GetAsync("/api/user/profile"))
            .Content.ReadFromJsonAsync<UserProfileResponse>();
        profile!.Email.ShouldBe(auth.Email);
    }

    /// <summary>An older copy of the site sends the unchanged email and phone back with the name;
    /// that must still save, and must not cost the customer their verifications.</summary>
    [Fact]
    public async Task UpdateProfile_LeavingContactDetailsAlone_KeepsTheirVerification()
    {
        using var client = _factory.CreateClient();
        var (auth, csrf) = await client.RegisterAsync();

        var request = new UpdateProfileRequest("Renamed Only", auth.Email.ToUpperInvariant(), auth.Phone);
        var response = await client.SendAsync(Json(HttpMethod.Put, "/api/user/profile", request, csrf));
        response.StatusCode.ShouldBe(HttpStatusCode.NoContent);

        var profile = await (await client.GetAsync("/api/user/profile"))
            .Content.ReadFromJsonAsync<UserProfileResponse>();
        profile!.FullName.ShouldBe("Renamed Only");
        profile.IsPhoneVerified.ShouldBeTrue();
    }

    [Fact]
    public async Task Addresses_AddListAndDelete_WithDefaultClearingAcrossMultiple()
    {
        using var client = _factory.CreateClient();
        var (_, csrf) = await client.RegisterAsync();

        var firstAddress = new SaveAddressRequest("Home", "123 Main St", 18.5, 73.8, true, "9123456780");
        var firstResponse = await client.SendAsync(Json(HttpMethod.Post, "/api/user/addresses", firstAddress, csrf));
        firstResponse.StatusCode.ShouldBe(HttpStatusCode.OK);

        var secondAddress = new SaveAddressRequest("Work", "456 Side St", 18.6, 73.9, true, "9123456781");
        var secondResponse = await client.SendAsync(Json(HttpMethod.Post, "/api/user/addresses", secondAddress, csrf));
        secondResponse.StatusCode.ShouldBe(HttpStatusCode.OK);

        var listResponse = await client.GetAsync("/api/user/addresses");
        listResponse.StatusCode.ShouldBe(HttpStatusCode.OK);
        var addresses = await listResponse.Content.ReadFromJsonAsync<List<SavedAddressDto>>();
        addresses.ShouldNotBeNull();
        addresses!.Count.ShouldBe(2);

        // Marking the second address default should have cleared the first's default flag.
        addresses.Single(a => a.Label == "Home").IsDefault.ShouldBeFalse();
        addresses.Single(a => a.Label == "Work").IsDefault.ShouldBeTrue();
        addresses.Single(a => a.Label == "Work").MapLink.ShouldBe("https://www.google.com/maps?q=18.6,73.9");

        var deleteResponse = await client.SendAsync(Json(HttpMethod.Delete, "/api/user/addresses/0", new { }, csrf));
        deleteResponse.StatusCode.ShouldBe(HttpStatusCode.OK);

        var afterDeleteResponse = await client.GetAsync("/api/user/addresses");
        var afterDelete = await afterDeleteResponse.Content.ReadFromJsonAsync<List<SavedAddressDto>>();
        afterDelete!.Count.ShouldBe(1);
        afterDelete[0].Label.ShouldBe("Work");
    }

    [Fact]
    public async Task AddAddress_ReturnsBadRequest_WhenLatLngMissing()
    {
        using var client = _factory.CreateClient();
        var (_, csrf) = await client.RegisterAsync();

        var request = new SaveAddressRequest("Home", "123 Main St", null, null, false, "9123456780");

        var response = await client.SendAsync(Json(HttpMethod.Post, "/api/user/addresses", request, csrf));

        response.StatusCode.ShouldBe(HttpStatusCode.BadRequest);
    }

    [Fact]
    public async Task DeleteAddress_ReturnsBadRequest_ForOutOfBoundsIndex()
    {
        using var client = _factory.CreateClient();
        var (_, csrf) = await client.RegisterAsync();

        var response = await client.SendAsync(Json(HttpMethod.Delete, "/api/user/addresses/5", new { }, csrf));

        response.StatusCode.ShouldBe(HttpStatusCode.BadRequest);
    }
}
