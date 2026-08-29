using System.IdentityModel.Tokens.Jwt;
using System.Text.Json;

namespace OjasApi.Services;

/// <summary>Whether the widget's access token is genuinely valid, and - critically - which phone
/// number MSG91 actually verified it for. VerifiedIdentifier must be checked against the phone
/// the caller claims to be logging in as; a token merely being "valid" is not enough, since it
/// proves someone verified some number, not that it was the number in this request.</summary>
public record Msg91VerificationResult(bool Success, string? VerifiedIdentifier, string? Error);

/// <summary>
/// Verifies an access token issued by MSG91 OTP Widget (client-side send + verify) against
/// MSG91's own servers - the widget hands the browser a token, and this is what confirms that
/// token is real rather than trusting it blindly. Chosen over the raw SendOTP API
/// (Msg91PhoneOtpSender) specifically because the widget's default channel configuration sends
/// through a pre-registered MSG91 template, which does not require this business's own DLT
/// registration - unlike a custom-branded SMS template, which does and was the original blocker.
///
/// The exact shape of MSG91's verify response is confirmed by logging the raw body on every call
/// until a real one has been observed end-to-end - MSG91's JS-rendered docs would not yield the
/// schema, so this is being verified against the actual API rather than guessed. Until then this
/// checks a few plausible success/identifier field names and fails closed (rejects) if none are
/// recognised, rather than trusting an unrecognised shape.
/// </summary>
public class Msg91WidgetVerifier
{
    private const string VerifyUrl = "https://control.msg91.com/api/v5/widget/verifyAccessToken";

    private readonly HttpClient _http;
    private readonly IConfiguration _config;
    private readonly ILogger<Msg91WidgetVerifier> _logger;

    public Msg91WidgetVerifier(HttpClient http, IConfiguration config, ILogger<Msg91WidgetVerifier> logger)
    {
        _http = http;
        _config = config;
        _logger = logger;
    }

    public bool IsConfigured => !string.IsNullOrWhiteSpace(_config["Msg91:WidgetAuthKey"]);

    /// <summary>Verifies the token, then checks the identifier MSG91 verified it for matches
    /// expectedPhone - comparing by the last 10 digits, since MSG91 returns numbers with a
    /// country-code prefix (e.g. 91XXXXXXXXXX) while Ojas stores the bare 10-digit number.</summary>
    public async Task<Msg91VerificationResult> VerifyAsync(string accessToken, string expectedPhone)
    {
        if (!IsConfigured)
            return new Msg91VerificationResult(false, null, "Phone login is not available yet.");

        var authKey = _config["Msg91:WidgetAuthKey"];
        var payload = new Dictionary<string, string>
        {
            ["authkey"] = authKey!,
            ["access-token"] = accessToken,
        };

        using var request = new HttpRequestMessage(HttpMethod.Post, VerifyUrl)
        {
            Content = new StringContent(JsonSerializer.Serialize(payload), System.Text.Encoding.UTF8, "application/json"),
        };

        string body;
        try
        {
            using var response = await _http.SendAsync(request);
            body = await response.Content.ReadAsStringAsync();

            // Logged at Information deliberately: this is what lets the exact response shape be
            // confirmed against a real call instead of guessed from MSG91's JS-rendered docs.
            // Trim this once the shape below is confirmed correct against production traffic.
            _logger.LogInformation("MSG91 widget verify response ({Status}): {Body}", (int)response.StatusCode, body);

            if (!response.IsSuccessStatusCode)
                return new Msg91VerificationResult(false, null, $"MSG91 verify failed ({(int)response.StatusCode}).");
        }
        catch (Exception ex)
        {
            _logger.LogWarning(ex, "MSG91 widget verify call failed.");
            return new Msg91VerificationResult(false, null, "Could not reach MSG91 to verify the code.");
        }

        using var doc = JsonDocument.Parse(body);
        var root = doc.RootElement;

        if (!IndicatesSuccess(root))
            return new Msg91VerificationResult(false, null, StringProperty(root, "message") ?? "That code is invalid or has expired.");

        var verifiedIdentifier = ExtractIdentifier(root) ?? ExtractIdentifierFromJwt(accessToken);
        if (string.IsNullOrWhiteSpace(verifiedIdentifier) || !PhoneMatches(verifiedIdentifier, expectedPhone))
        {
            // Fails closed: a token that verifies successfully but cannot be tied to the phone
            // this login attempt claims is exactly what would let someone verify their own
            // number and reuse the token against somebody else account.
            _logger.LogWarning(
                "MSG91 token verified but its identifier ({Verified}) could not be confirmed against the requested phone.",
                verifiedIdentifier);
            return new Msg91VerificationResult(false, null, "That code is invalid or has expired.");
        }

        return new Msg91VerificationResult(true, verifiedIdentifier, null);
    }

    private static bool IndicatesSuccess(JsonElement root)
    {
        var type = StringProperty(root, "type");
        if (type != null)
            return string.Equals(type, "success", StringComparison.OrdinalIgnoreCase);

        if (root.TryGetProperty("success", out var successEl))
        {
            if (successEl.ValueKind == JsonValueKind.True) return true;
            if (successEl.ValueKind == JsonValueKind.False) return false;
        }

        var status = StringProperty(root, "status");
        return string.Equals(status, "success", StringComparison.OrdinalIgnoreCase) ||
            string.Equals(status, "200", StringComparison.OrdinalIgnoreCase);
    }

    private static string? ExtractIdentifier(JsonElement root)
    {
        foreach (var name in new[] { "identifier", "mobile", "phone", "verified_identifier" })
        {
            var value = StringProperty(root, name);
            if (!string.IsNullOrWhiteSpace(value)) return value;
        }

        if (root.TryGetProperty("data", out var data) && data.ValueKind == JsonValueKind.Object)
        {
            foreach (var name in new[] { "identifier", "mobile", "phone" })
            {
                var value = StringProperty(data, name);
                if (!string.IsNullOrWhiteSpace(value)) return value;
            }
        }

        return null;
    }

    /// <summary>Reads the token's own claims without validating its signature - it is only
    /// trusted as a source of the identifier after MSG91's verify call has already confirmed the
    /// token itself is genuine, never before.</summary>
    private static string? ExtractIdentifierFromJwt(string accessToken)
    {
        try
        {
            var handler = new JwtSecurityTokenHandler();
            if (!handler.CanReadToken(accessToken)) return null;

            var token = handler.ReadJwtToken(accessToken);
            foreach (var name in new[] { "identifier", "mobile", "phone", "sub" })
            {
                var claim = token.Claims.FirstOrDefault(c => string.Equals(c.Type, name, StringComparison.OrdinalIgnoreCase));
                if (claim != null && !string.IsNullOrWhiteSpace(claim.Value)) return claim.Value;
            }
        }
        catch
        {
            // Not a JWT, or unreadable - ExtractIdentifier already had first chance; both failing
            // means the token is treated as unverifiable, not as verified-for-anything.
        }

        return null;
    }

    private static bool PhoneMatches(string a, string b) => LastTenDigits(a) == LastTenDigits(b) && LastTenDigits(a).Length == 10;

    private static string LastTenDigits(string phone)
    {
        var digits = new string(phone.Where(char.IsDigit).ToArray());
        return digits.Length > 10 ? digits[^10..] : digits;
    }

    private static string? StringProperty(JsonElement element, string name) =>
        element.ValueKind == JsonValueKind.Object && element.TryGetProperty(name, out var value) && value.ValueKind == JsonValueKind.String
            ? value.GetString()
            : null;
}
