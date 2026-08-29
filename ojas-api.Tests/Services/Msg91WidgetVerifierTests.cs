using System.Net;
using System.Text;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.Logging.Abstractions;
using OjasApi.Services;
using Shouldly;

namespace OjasApi.Tests.Services;

public class Msg91WidgetVerifierTests
{
    private const string WidgetAuthKey = "test-widget-authkey";
    private const string Phone = "9123456789";

    private sealed class FakeHandler(Func<HttpRequestMessage, HttpResponseMessage> respond) : HttpMessageHandler
    {
        protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancellationToken) =>
            Task.FromResult(respond(request));
    }

    private static IConfiguration ConfiguredSettings() =>
        new ConfigurationBuilder()
            .AddInMemoryCollection(new Dictionary<string, string?> { ["Msg91:WidgetAuthKey"] = WidgetAuthKey })
            .Build();

    private static IConfiguration UnconfiguredSettings() => new ConfigurationBuilder().Build();

    private static Msg91WidgetVerifier MakeVerifier(Func<HttpRequestMessage, HttpResponseMessage> respond, IConfiguration? config = null) =>
        new(new HttpClient(new FakeHandler(respond)), config ?? ConfiguredSettings(), NullLogger<Msg91WidgetVerifier>.Instance);

    private static HttpResponseMessage Json(HttpStatusCode status, string body) =>
        new(status) { Content = new StringContent(body, Encoding.UTF8, "application/json") };

    // ---------- IsConfigured ----------

    [Fact]
    public async Task VerifyAsync_FailsWithoutHittingTheNetwork_WhenUnconfigured()
    {
        var called = false;
        var verifier = MakeVerifier(_ => { called = true; return Json(HttpStatusCode.OK, "{}"); }, UnconfiguredSettings());

        var result = await verifier.VerifyAsync("some-token", Phone);

        result.Success.ShouldBeFalse();
        called.ShouldBeFalse();
    }

    // ---------- Success shapes ----------

    [Fact]
    public async Task VerifyAsync_Succeeds_WhenTypeIsSuccessAndIdentifierMatches()
    {
        var verifier = MakeVerifier(_ => Json(HttpStatusCode.OK,
            """{"type":"success","identifier":"919123456789"}"""));

        var result = await verifier.VerifyAsync("some-token", Phone);

        result.Success.ShouldBeTrue();
        result.VerifiedIdentifier.ShouldBe("919123456789");
    }

    [Fact]
    public async Task VerifyAsync_Succeeds_WhenIdentifierIsNestedUnderData()
    {
        var verifier = MakeVerifier(_ => Json(HttpStatusCode.OK,
            """{"type":"success","data":{"identifier":"919123456789"}}"""));

        var result = await verifier.VerifyAsync("some-token", Phone);

        result.Success.ShouldBeTrue();
    }

    [Fact]
    public async Task VerifyAsync_Succeeds_WhenABooleanSuccessFieldIsUsedInstead()
    {
        var verifier = MakeVerifier(_ => Json(HttpStatusCode.OK,
            """{"success":true,"mobile":"919123456789"}"""));

        var result = await verifier.VerifyAsync("some-token", Phone);

        result.Success.ShouldBeTrue();
    }

    // ---------- Failure shapes ----------

    [Theory]
    [InlineData("""{"type":"error","message":"expired"}""")]
    [InlineData("""{"success":false}""")]
    [InlineData("""{"type":"failed"}""")]
    public async Task VerifyAsync_Fails_ForRecognisedFailureShapes(string body)
    {
        var verifier = MakeVerifier(_ => Json(HttpStatusCode.OK, body));

        var result = await verifier.VerifyAsync("some-token", Phone);

        result.Success.ShouldBeFalse();
    }

    [Fact]
    public async Task VerifyAsync_FailsClosed_WhenTheShapeIsUnrecognised()
    {
        // No "type", no "success", no "status" - an honest unknown, not treated as a pass.
        var verifier = MakeVerifier(_ => Json(HttpStatusCode.OK, """{"whatever":"value"}"""));

        var result = await verifier.VerifyAsync("some-token", Phone);

        result.Success.ShouldBeFalse();
    }

    [Fact]
    public async Task VerifyAsync_Fails_OnANonSuccessHttpStatus()
    {
        var verifier = MakeVerifier(_ => Json(HttpStatusCode.Unauthorized, """{"type":"success","identifier":"919123456789"}"""));

        var result = await verifier.VerifyAsync("some-token", Phone);

        result.Success.ShouldBeFalse();
    }

    [Fact]
    public async Task VerifyAsync_Fails_WhenTheNetworkCallThrows()
    {
        var verifier = new Msg91WidgetVerifier(
            new HttpClient(new ThrowingHandler()), ConfiguredSettings(), NullLogger<Msg91WidgetVerifier>.Instance);

        var result = await verifier.VerifyAsync("some-token", Phone);

        result.Success.ShouldBeFalse();
    }

    private sealed class ThrowingHandler : HttpMessageHandler
    {
        protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancellationToken) =>
            throw new HttpRequestException("network down");
    }

    // ---------- The security-critical part: binding the token to the requested phone ----------

    [Fact]
    public async Task VerifyAsync_Fails_WhenTheVerifiedIdentifierIsForADifferentPhone()
    {
        // A token proving *some* number was verified must not be accepted for a *different*
        // number just because the gateway call itself succeeded.
        var verifier = MakeVerifier(_ => Json(HttpStatusCode.OK,
            """{"type":"success","identifier":"919999999999"}"""));

        var result = await verifier.VerifyAsync("some-token", Phone);

        result.Success.ShouldBeFalse();
    }

    [Fact]
    public async Task VerifyAsync_Fails_WhenSuccessfulButNoIdentifierCanBeFoundAnywhere()
    {
        var verifier = MakeVerifier(_ => Json(HttpStatusCode.OK, """{"type":"success"}"""));

        // No identifier in the response, and "some-token" isn't a JWT, so the JWT fallback finds
        // nothing either - must fail closed rather than trust an unbound success.
        var result = await verifier.VerifyAsync("some-token", Phone);

        result.Success.ShouldBeFalse();
    }

    [Theory]
    [InlineData("919123456789")] // country code, no plus
    [InlineData("9123456789")]   // bare 10-digit
    [InlineData("+919123456789")] // with plus, just in case
    public async Task VerifyAsync_MatchesThePhone_RegardlessOfCountryCodeFormatting(string verifiedIdentifier)
    {
        var verifier = MakeVerifier(_ => Json(HttpStatusCode.OK,
            $$"""{"type":"success","identifier":"{{verifiedIdentifier}}"}"""));

        var result = await verifier.VerifyAsync("some-token", Phone);

        result.Success.ShouldBeTrue();
    }
}
