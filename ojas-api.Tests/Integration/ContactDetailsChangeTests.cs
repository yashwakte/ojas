using System.Net;
using System.Net.Http.Json;
using OjasApi.Models;
using OjasApi.Tests.TestHelpers;
using Shouldly;

namespace OjasApi.Tests.Integration;

/// <summary>
/// The email and phone on an account change only once a code sent to the new one has come back -
/// the code alone, no password (the owner's call). These drive the real endpoints end to end: the email codes
/// come back as devCode because the test host runs as Development, and the phone step uses the
/// fake MSG91 transport's per-number tokens, so a token for one number cannot pass for another.
/// </summary>
[Collection(MongoCollectionFixture.Name)]
public class ContactDetailsChangeTests : IDisposable
{
    private const string Password = "Passw0rd123!";

    private readonly OjasApiFactory _factory;

    public ContactDetailsChangeTests(MongoRunnerFixture mongo)
    {
        _factory = new OjasApiFactory(mongo);
    }

    public void Dispose()
    {
        _factory.Dispose();
    }

    private static string NewPhone() => $"9{Random.Shared.NextInt64(0, 1_000_000_000):D9}";

    private static string NewEmail() => $"moved.{Guid.NewGuid():N}@example.com";

    private static Task<HttpResponseMessage> Post(HttpClient client, string url, object body, string csrf)
    {
        var request = new HttpRequestMessage(HttpMethod.Post, url) { Content = JsonContent.Create(body) };
        request.AttachCsrf(csrf);
        return client.SendAsync(request);
    }

    private static async Task<UserProfileResponse> GetProfile(HttpClient client) =>
        (await (await client.GetAsync("/api/user/profile")).Content.ReadFromJsonAsync<UserProfileResponse>())!;

    private static async Task<string> SendEmailCode(HttpClient client, string csrf, string email)
    {
        var response = await Post(client, "/api/user/email/send-code", new SendEmailCodeRequest(email), csrf);
        response.StatusCode.ShouldBe(HttpStatusCode.OK);
        var sent = await response.Content.ReadFromJsonAsync<ContactCodeSentResponse>();
        return sent!.DevCode!;
    }

    // ---------- Confirming the email already on the account ----------

    [Fact]
    public async Task ConfirmingTheCurrentEmail_NeedsOnlyTheCode_AndLeavesTheSessionAlone()
    {
        using var client = _factory.CreateClient();
        var (auth, csrf) = await client.RegisterAsync();

        var code = await SendEmailCode(client, csrf, auth.Email);
        var verify = await Post(client, "/api/user/email/verify", new VerifyEmailCodeRequest(auth.Email, code), csrf);

        verify.StatusCode.ShouldBe(HttpStatusCode.OK);
        var profile = await verify.Content.ReadFromJsonAsync<UserProfileResponse>();
        profile!.IsEmailVerified.ShouldBeTrue();
        profile.Email.ShouldBe(auth.Email);

        // Unlike the anonymous registration endpoint, this issues no new session - the CSRF token
        // the customer already holds must still work.
        var rename = new HttpRequestMessage(HttpMethod.Put, "/api/user/profile")
        {
            Content = JsonContent.Create(new UpdateProfileRequest("Still Signed In")),
        };
        rename.AttachCsrf(csrf);
        (await client.SendAsync(rename)).StatusCode.ShouldBe(HttpStatusCode.NoContent);
    }

    [Fact]
    public async Task ConfirmingAnAlreadyVerifiedEmail_IsRefused()
    {
        using var client = _factory.CreateClient();
        var (auth, csrf) = await client.RegisterAsync();
        var code = await SendEmailCode(client, csrf, auth.Email);
        await Post(client, "/api/user/email/verify", new VerifyEmailCodeRequest(auth.Email, code), csrf);

        var again = await Post(client, "/api/user/email/send-code", new SendEmailCodeRequest(auth.Email), csrf);

        again.StatusCode.ShouldBe(HttpStatusCode.BadRequest);
    }

    [Fact]
    public async Task AWrongEmailCode_LeavesTheEmailUnverified()
    {
        using var client = _factory.CreateClient();
        var (auth, csrf) = await client.RegisterAsync();
        var code = await SendEmailCode(client, csrf, auth.Email);
        var wrong = code == "000000" ? "111111" : "000000";

        var verify = await Post(client, "/api/user/email/verify", new VerifyEmailCodeRequest(auth.Email, wrong), csrf);

        verify.StatusCode.ShouldBe(HttpStatusCode.BadRequest);
        (await GetProfile(client)).IsEmailVerified.ShouldBeFalse();
    }

    // ---------- Moving to a new email ----------

    [Fact]
    public async Task ChangingTheEmail_WithTheCodeAlone_MovesTheAccount_AlreadyVerified()
    {
        using var client = _factory.CreateClient();
        var (auth, csrf) = await client.RegisterAsync();
        var newEmail = NewEmail();

        var code = await SendEmailCode(client, csrf, newEmail);
        var verify = await Post(client, "/api/user/email/verify", new VerifyEmailCodeRequest(newEmail, code), csrf);

        verify.StatusCode.ShouldBe(HttpStatusCode.OK);
        var profile = await verify.Content.ReadFromJsonAsync<UserProfileResponse>();
        profile!.Email.ShouldBe(newEmail);
        profile.IsEmailVerified.ShouldBeTrue();

        using var fresh = _factory.CreateClient();
        await fresh.LoginAsync(newEmail, Password);
        var oldLogin = await fresh.PostAsJsonAsync(
            "/api/auth/login", new LoginRequest(auth.Email, Password, "test-turnstile-token"));
        oldLogin.StatusCode.ShouldBe(HttpStatusCode.Unauthorized);
    }

    [Fact]
    public async Task ChangingTheEmail_ToOneAnotherAccountUses_IsRefused()
    {
        using var first = _factory.CreateClient();
        var (firstAuth, _) = await first.RegisterAsync();
        using var second = _factory.CreateClient();
        var (_, secondCsrf) = await second.RegisterAsync();

        var response = await Post(
            second, "/api/user/email/send-code", new SendEmailCodeRequest(firstAuth.Email), secondCsrf);

        response.StatusCode.ShouldBe(HttpStatusCode.Conflict);
    }

    [Fact]
    public async Task AnEmailCode_OnlyWorksForTheAccountAndTheAddressItWasSentFor()
    {
        using var owner = _factory.CreateClient();
        var (_, ownerCsrf) = await owner.RegisterAsync();
        using var other = _factory.CreateClient();
        var (otherAuth, otherCsrf) = await other.RegisterAsync();
        var newEmail = NewEmail();
        var code = await SendEmailCode(owner, ownerCsrf, newEmail);

        var byOtherAccount = await Post(other, "/api/user/email/verify", new VerifyEmailCodeRequest(newEmail, code), otherCsrf);
        var forOtherAddress = await Post(owner, "/api/user/email/verify", new VerifyEmailCodeRequest(NewEmail(), code), ownerCsrf);

        byOtherAccount.StatusCode.ShouldBe(HttpStatusCode.BadRequest);
        forOtherAddress.StatusCode.ShouldBe(HttpStatusCode.BadRequest);
        (await GetProfile(other)).Email.ShouldBe(otherAuth.Email);

        // Neither refusal spent the real code.
        (await Post(owner, "/api/user/email/verify", new VerifyEmailCodeRequest(newEmail, code), ownerCsrf))
            .StatusCode.ShouldBe(HttpStatusCode.OK);
    }

    /// <summary>A code sent to confirm the account's address cannot later be spent as a change back
    /// to that address once the email has moved on - it was never issued for that.</summary>
    [Fact]
    public async Task AConfirmationCode_CannotLaterMoveTheAccountBackToThatAddress()
    {
        using var client = _factory.CreateClient();
        var (auth, csrf) = await client.RegisterAsync();
        var confirmCode = await SendEmailCode(client, csrf, auth.Email);

        var newEmail = NewEmail();
        var changeCode = await SendEmailCode(client, csrf, newEmail);
        (await Post(client, "/api/user/email/verify", new VerifyEmailCodeRequest(newEmail, changeCode), csrf))
            .StatusCode.ShouldBe(HttpStatusCode.OK);

        var back = await Post(client, "/api/user/email/verify", new VerifyEmailCodeRequest(auth.Email, confirmCode), csrf);

        back.StatusCode.ShouldBe(HttpStatusCode.BadRequest);
        (await GetProfile(client)).Email.ShouldBe(newEmail);
    }

    // ---------- Moving to a new phone number ----------

    [Fact]
    public async Task ChangingThePhone_WithTheTextedCodeAlone_MovesTheAccount_AlreadyVerified()
    {
        using var client = _factory.CreateClient();
        var (_, csrf) = await client.RegisterAsync();
        var newPhone = NewPhone();

        var start = await Post(client, "/api/user/phone/start", new StartPhoneChangeRequest(newPhone), csrf);
        start.StatusCode.ShouldBe(HttpStatusCode.OK);

        var verify = await Post(
            client, "/api/user/phone/verify",
            new VerifyPhoneChangeRequest(newPhone, FakeMsg91WidgetHandler.TokenFor(newPhone)), csrf);

        verify.StatusCode.ShouldBe(HttpStatusCode.OK);
        var profile = await verify.Content.ReadFromJsonAsync<UserProfileResponse>();
        profile!.Phone.ShouldBe(newPhone);
        profile.IsPhoneVerified.ShouldBeTrue();
    }

    [Fact]
    public async Task ChangingThePhone_WithoutStartingIt_IsRefused()
    {
        using var client = _factory.CreateClient();
        var (auth, csrf) = await client.RegisterAsync();
        var newPhone = NewPhone();

        var verify = await Post(
            client, "/api/user/phone/verify",
            new VerifyPhoneChangeRequest(newPhone, FakeMsg91WidgetHandler.TokenFor(newPhone)), csrf);

        verify.StatusCode.ShouldBe(HttpStatusCode.BadRequest);
        (await GetProfile(client)).Phone.ShouldBe(auth.Phone);
    }

    /// <summary>The exact trick this whole change exists to stop: prove a number you own, then
    /// put a different one on the account.</summary>
    [Fact]
    public async Task ChangingThePhone_WithATokenForADifferentNumber_IsRefused()
    {
        using var client = _factory.CreateClient();
        var (auth, csrf) = await client.RegisterAsync();
        var claimed = NewPhone();
        var actuallyVerified = NewPhone();

        await Post(client, "/api/user/phone/start", new StartPhoneChangeRequest(claimed), csrf);
        var verify = await Post(
            client, "/api/user/phone/verify",
            new VerifyPhoneChangeRequest(claimed, FakeMsg91WidgetHandler.TokenFor(actuallyVerified)), csrf);

        verify.StatusCode.ShouldBe(HttpStatusCode.BadRequest);
        (await GetProfile(client)).Phone.ShouldBe(auth.Phone);
    }

    [Fact]
    public async Task ChangingThePhone_ToANumberOtherThanTheOneStarted_IsRefused()
    {
        using var client = _factory.CreateClient();
        var (auth, csrf) = await client.RegisterAsync();
        var started = NewPhone();
        var swapped = NewPhone();

        await Post(client, "/api/user/phone/start", new StartPhoneChangeRequest(started), csrf);
        var verify = await Post(
            client, "/api/user/phone/verify",
            new VerifyPhoneChangeRequest(swapped, FakeMsg91WidgetHandler.TokenFor(swapped)), csrf);

        verify.StatusCode.ShouldBe(HttpStatusCode.BadRequest);
        (await GetProfile(client)).Phone.ShouldBe(auth.Phone);
    }

    [Fact]
    public async Task ChangingThePhone_ToOneAnotherAccountUses_IsRefused()
    {
        using var first = _factory.CreateClient();
        var (firstAuth, _) = await first.RegisterAsync();
        using var second = _factory.CreateClient();
        var (_, secondCsrf) = await second.RegisterAsync();

        var start = await Post(second, "/api/user/phone/start", new StartPhoneChangeRequest(firstAuth.Phone), secondCsrf);

        start.StatusCode.ShouldBe(HttpStatusCode.Conflict);
    }
}
