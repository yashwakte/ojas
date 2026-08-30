using System.Collections.Concurrent;
using System.Net;
using System.Text;
using System.Text.Json;

namespace OjasApi.Tests.TestHelpers;

/// <summary>
/// Stands in for MSG91's Verify Access Token API so tests exercise the real
/// <see cref="OjasApi.Services.Msg91WidgetVerifier"/> without a network call.
///
/// Two ways to get a token that verifies successfully, once, for a given phone:
/// <see cref="IssueToken"/> registers an opaque random one on this specific handler instance,
/// for tests that already hold a reference to the factory. <see cref="TokenFor"/> is a pure,
/// static function of the phone alone - usable from helpers like AuthFlowExtensions.RegisterAsync
/// that only have an HttpClient, with no way to reach the OjasApiFactory that owns this handler.
/// Either way, a second verify attempt with the same token is refused, mirroring how a real OTP
/// code cannot be redeemed twice; an unrecognised token is refused the same way an expired or
/// never-issued code would be.
/// </summary>
public sealed class FakeMsg91WidgetHandler : HttpMessageHandler
{
    public const string WidgetAuthKey = "test-msg91-widget-authkey";
    private const string DeterministicPrefix = "test-widget-token-for:";

    private readonly ConcurrentDictionary<string, string> _tokens = new();
    private readonly ConcurrentDictionary<string, bool> _redeemed = new();

    /// <summary>Registers a token that verifies successfully, once, for the given phone.</summary>
    public string IssueToken(string phone)
    {
        var token = $"widget-token-{Guid.NewGuid():N}";
        _tokens[token] = phone;
        return token;
    }

    /// <summary>A token for this phone that this handler will accept without any prior
    /// registration - the phone is encoded in the token itself. Static and side-effect-free, so
    /// it can be computed by a caller with no reference to this specific handler instance.</summary>
    public static string TokenFor(string phone) => $"{DeterministicPrefix}{phone}";

    protected override async Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancellationToken)
    {
        var body = request.Content == null ? "" : await request.Content.ReadAsStringAsync(cancellationToken);
        using var doc = JsonDocument.Parse(string.IsNullOrWhiteSpace(body) ? "{}" : body);
        var token = doc.RootElement.TryGetProperty("access-token", out var el) ? el.GetString() ?? "" : "";

        if (!_redeemed.TryAdd(token, true))
            return Json(HttpStatusCode.OK, """{"type":"error","message":"That code is invalid or has expired."}""");

        var identifier = token.StartsWith(DeterministicPrefix, StringComparison.Ordinal)
            ? token[DeterministicPrefix.Length..]
            : _tokens.GetValueOrDefault(token);

        if (identifier == null)
            return Json(HttpStatusCode.OK, """{"type":"error","message":"That code is invalid or has expired."}""");

        return Json(HttpStatusCode.OK, JsonSerializer.Serialize(new { type = "success", identifier }));
    }

    private static HttpResponseMessage Json(HttpStatusCode status, string body) =>
        new(status) { Content = new StringContent(body, Encoding.UTF8, "application/json") };
}
