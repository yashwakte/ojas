using System.Text.Json;
using System.Text.Json.Serialization;

namespace OjasApi.Services;

/// <summary>
/// Verifies a Turnstile widget token server-side via Cloudflare's siteverify endpoint.
/// Turnstile:SecretKey is required at startup (see Program.cs) - unlike Smtp/MSG91, a
/// missing CAPTCHA secret isn't something safe to silently degrade past, since that would
/// mean shipping with no bot protection at all and no signal that it happened.
/// </summary>
public class CloudflareTurnstileVerifier : ITurnstileVerifier
{
    private const string VerifyUrl = "https://challenges.cloudflare.com/turnstile/v0/siteverify";

    private readonly HttpClient _http;
    private readonly IConfiguration _config;
    private readonly ILogger<CloudflareTurnstileVerifier> _logger;

    public CloudflareTurnstileVerifier(HttpClient http, IConfiguration config, ILogger<CloudflareTurnstileVerifier> logger)
    {
        _http = http;
        _config = config;
        _logger = logger;
    }

    public async Task<bool> VerifyAsync(string token, string? remoteIp)
    {
        if (string.IsNullOrWhiteSpace(token))
            return false;

        var secretKey = _config["Turnstile:SecretKey"]!;
        var fields = new Dictionary<string, string>
        {
            ["secret"] = secretKey,
            ["response"] = token,
        };
        if (!string.IsNullOrWhiteSpace(remoteIp))
            fields["remoteip"] = remoteIp;

        try
        {
            using var response = await _http.PostAsync(VerifyUrl, new FormUrlEncodedContent(fields));
            var body = await response.Content.ReadAsStringAsync();
            if (!response.IsSuccessStatusCode)
            {
                _logger.LogWarning("Turnstile siteverify returned {Status}: {Body}", response.StatusCode, body);
                return false;
            }

            var result = JsonSerializer.Deserialize<SiteVerifyResponse>(body);
            return result?.Success == true;
        }
        catch (Exception ex)
        {
            _logger.LogWarning(ex, "Turnstile siteverify call failed.");
            return false;
        }
    }

    private record SiteVerifyResponse(
        [property: JsonPropertyName("success")] bool Success,
        [property: JsonPropertyName("error-codes")] string[]? ErrorCodes);
}
