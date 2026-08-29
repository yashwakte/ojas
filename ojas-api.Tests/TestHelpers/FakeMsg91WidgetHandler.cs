using System.Collections.Concurrent;
using System.Net;
using System.Text;
using System.Text.Json;

namespace OjasApi.Tests.TestHelpers;

/// <summary>
/// Stands in for MSG91's Verify Access Token API so tests exercise the real
/// <see cref="OjasApi.Services.Msg91WidgetVerifier"/> without a network call.
///
/// Tests issue a token for a phone with <see cref="IssueToken"/> - standing in for a customer
/// having completed the real widget's send-and-enter-code flow for that number - and this
/// handler reports it verified, once. A second verify attempt with the same token is refused,
/// mirroring how a real OTP code cannot be redeemed twice; an unregistered token is refused the
/// same way an expired or never-issued code would be.
/// </summary>
public sealed class FakeMsg91WidgetHandler : HttpMessageHandler
{
    public const string WidgetAuthKey = "test-msg91-widget-authkey";

    private readonly ConcurrentDictionary<string, string> _tokens = new();
    private readonly ConcurrentDictionary<string, bool> _redeemed = new();

    /// <summary>Registers a token that verifies successfully, once, for the given phone.</summary>
    public string IssueToken(string phone)
    {
        var token = $"widget-token-{Guid.NewGuid():N}";
        _tokens[token] = phone;
        return token;
    }

    protected override async Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancellationToken)
    {
        var body = request.Content == null ? "" : await request.Content.ReadAsStringAsync(cancellationToken);
        using var doc = JsonDocument.Parse(string.IsNullOrWhiteSpace(body) ? "{}" : body);
        var token = doc.RootElement.TryGetProperty("access-token", out var el) ? el.GetString() ?? "" : "";

        if (!_redeemed.TryAdd(token, true) || !_tokens.TryGetValue(token, out var identifier))
        {
            return Json(HttpStatusCode.OK, """{"type":"error","message":"That code is invalid or has expired."}""");
        }

        return Json(HttpStatusCode.OK, JsonSerializer.Serialize(new { type = "success", identifier }));
    }

    private static HttpResponseMessage Json(HttpStatusCode status, string body) =>
        new(status) { Content = new StringContent(body, Encoding.UTF8, "application/json") };
}
