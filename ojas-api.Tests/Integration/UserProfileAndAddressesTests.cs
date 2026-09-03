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
    public async Task UpdateProfile_Success_PersistsNewDetails()
    {
        using var client = _factory.CreateClient();
        var (auth, csrf) = await client.RegisterAsync();

        var newEmailSuffix = Guid.NewGuid().ToString("N")[..8];
        var request = new UpdateProfileRequest("Updated Name", $"updated.{newEmailSuffix}@example.com", auth.Phone);

        var response = await client.SendAsync(Json(HttpMethod.Put, "/api/user/profile", request, csrf));

        response.StatusCode.ShouldBe(HttpStatusCode.NoContent);

        var profileResponse = await client.GetAsync("/api/user/profile");
        var profile = await profileResponse.Content.ReadFromJsonAsync<UserProfileResponse>();
        profile!.FullName.ShouldBe("Updated Name");
        profile.Email.ShouldBe(request.Email);
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

    /// <summary>The phone gate the whole of registration rests on is worthless if this form can
    /// swap the number while keeping the flag - a customer could verify a number they own, then
    /// change it to one they do not and still count as verified.</summary>
    [Fact]
    public async Task UpdateProfile_ChangingThePhone_ClearsItsVerification()
    {
        using var client = _factory.CreateClient();
        var (auth, csrf) = await client.RegisterAsync();

        var differentPhone = $"9{Math.Abs(Guid.NewGuid().GetHashCode()).ToString().PadLeft(9, '0')[..9]}";
        var request = new UpdateProfileRequest(auth.FullName, auth.Email, differentPhone);

        var response = await client.SendAsync(Json(HttpMethod.Put, "/api/user/profile", request, csrf));
        response.StatusCode.ShouldBe(HttpStatusCode.NoContent);

        var profile = await (await client.GetAsync("/api/user/profile"))
            .Content.ReadFromJsonAsync<UserProfileResponse>();
        profile!.Phone.ShouldBe(differentPhone);
        profile.IsPhoneVerified.ShouldBeFalse();
    }

    /// <summary>Same reasoning for the address: a verified flag must describe the value actually
    /// held, not one that was replaced afterwards.</summary>
    [Fact]
    public async Task UpdateProfile_ChangingTheEmail_ClearsItsVerification()
    {
        using var client = _factory.CreateClient();
        var (auth, csrf) = await client.RegisterAsync();

        // Prove the address first, so there is a verification for the change to throw away.
        var resend = await client.PostAsJsonAsync("/api/auth/resend-email-otp", new ResendEmailOtpRequest(auth.Email));
        var devCode = (await resend.Content.ReadFromJsonAsync<ResendDevResponse>())!.DevCode!;
        var verifyResponse = await client.PostAsJsonAsync(
            "/api/auth/verify-email-otp", new VerifyEmailOtpRequest(auth.Email, devCode));

        // Verifying the email re-issues the session, because the phone is already verified and
        // CompleteRegistrationStepAsync issues one the moment both are true. That rotates the CSRF
        // token, so the one captured at registration is now stale - the frontend has to swap in
        // the returned session for exactly the same reason.
        var step = await verifyResponse.Content.ReadFromJsonAsync<RegistrationStepResponse>();
        var rotatedCsrf = step!.Session!.CsrfToken;

        var verified = await (await client.GetAsync("/api/user/profile"))
            .Content.ReadFromJsonAsync<UserProfileResponse>();
        verified!.IsEmailVerified.ShouldBeTrue();

        var request = new UpdateProfileRequest(
            auth.FullName, $"changed.{Guid.NewGuid():N}@example.com".Replace("-", ""), auth.Phone);
        var response = await client.SendAsync(Json(HttpMethod.Put, "/api/user/profile", request, rotatedCsrf));
        response.StatusCode.ShouldBe(HttpStatusCode.NoContent);

        var profile = await (await client.GetAsync("/api/user/profile"))
            .Content.ReadFromJsonAsync<UserProfileResponse>();
        profile!.IsEmailVerified.ShouldBeFalse();
    }

    /// <summary>Editing only the name must not cost the customer their verifications.</summary>
    [Fact]
    public async Task UpdateProfile_LeavingContactDetailsAlone_KeepsTheirVerification()
    {
        using var client = _factory.CreateClient();
        var (auth, csrf) = await client.RegisterAsync();

        var request = new UpdateProfileRequest("Renamed Only", auth.Email, auth.Phone);
        await client.SendAsync(Json(HttpMethod.Put, "/api/user/profile", request, csrf));

        var profile = await (await client.GetAsync("/api/user/profile"))
            .Content.ReadFromJsonAsync<UserProfileResponse>();
        profile!.FullName.ShouldBe("Renamed Only");
        profile.IsPhoneVerified.ShouldBeTrue();
    }

    private record ResendDevResponse(string Message, string? DevCode);

    [Fact]
    public async Task UpdateProfile_EmailConflict_WithAnotherAccount_ReturnsConflict()
    {
        using var firstClient = _factory.CreateClient();
        var (firstAuth, _) = await firstClient.RegisterAsync();

        using var secondClient = _factory.CreateClient();
        var (secondAuth, secondCsrf) = await secondClient.RegisterAsync();

        var request = new UpdateProfileRequest("Second User", firstAuth.Email, secondAuth.Phone);

        var response = await secondClient.SendAsync(Json(HttpMethod.Put, "/api/user/profile", request, secondCsrf));

        response.StatusCode.ShouldBe(HttpStatusCode.Conflict);
    }

    [Fact]
    public async Task UpdateProfile_PhoneConflict_WithAnotherAccount_ReturnsConflict()
    {
        using var firstClient = _factory.CreateClient();
        var (firstAuth, _) = await firstClient.RegisterAsync();

        using var secondClient = _factory.CreateClient();
        var (secondAuth, secondCsrf) = await secondClient.RegisterAsync();

        var request = new UpdateProfileRequest("Second User", secondAuth.Email, firstAuth.Phone);

        var response = await secondClient.SendAsync(Json(HttpMethod.Put, "/api/user/profile", request, secondCsrf));

        response.StatusCode.ShouldBe(HttpStatusCode.Conflict);
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
