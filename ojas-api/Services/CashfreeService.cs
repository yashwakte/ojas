using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using OjasApi.Models;

namespace OjasApi.Services;

public record CashfreeOrderResult(string CfOrderId, string PaymentSessionId);

public record CashfreeRefundResult(bool Success, string? RefundStatus, string? Error);

/// <summary>
/// Cashfree Payment Gateway integration (Orders API v2023-08-01). Sandbox vs production is
/// picked by base URL, per Cashfree:Environment - the client id/secret pair itself is also
/// environment-specific (Cashfree issues separate test and live credentials), so both need to
/// be swapped together when going live, not just the URL.
/// </summary>
public class CashfreeService
{
    private const string ApiVersion = "2023-08-01";

    private readonly HttpClient _http;
    private readonly IConfiguration _config;

    public CashfreeService(HttpClient http, IConfiguration config)
    {
        _config = config;
        var isSandbox = !string.Equals(_config["Cashfree:Environment"], "production", StringComparison.OrdinalIgnoreCase);
        http.BaseAddress = new Uri(isSandbox ? "https://sandbox.cashfree.com" : "https://api.cashfree.com");
        _http = http;
    }

    public bool IsConfigured =>
        !string.IsNullOrWhiteSpace(_config["Cashfree:ClientId"]) &&
        !string.IsNullOrWhiteSpace(_config["Cashfree:ClientSecret"]);

    /// <summary>Creates the order on Cashfree's side for the amount already computed and stored
    /// server-side on this Order - the browser never supplies a price. Returns the
    /// payment_session_id the frontend's checkout SDK needs to open the hosted payment page.</summary>
    public async Task<CashfreeOrderResult> CreateOrderAsync(Order order)
    {
        if (!IsConfigured)
            throw new InvalidOperationException("Cashfree is not configured (Cashfree:ClientId / Cashfree:ClientSecret missing).");

        var payload = new
        {
            order_id = order.Id,
            order_amount = order.TotalAmount,
            order_currency = "INR",
            customer_details = new
            {
                customer_id = order.UserId ?? order.Id,
                customer_name = order.FullName,
                customer_phone = NormalizePhone(order.Phone),
            },
            order_meta = new
            {
                // Informational only - the customer lands here after paying, but this redirect
                // is never what marks the order paid. Only the verified webhook does that.
                return_url = $"{_config["Frontend:BaseUrl"]}/my-orders?cashfreeOrderId={order.Id}",
            },
        };

        using var request = BuildRequest(HttpMethod.Post, "/pg/orders", payload);
        var response = await _http.SendAsync(request);
        var body = await response.Content.ReadAsStringAsync();

        if (!response.IsSuccessStatusCode)
            throw new InvalidOperationException($"Cashfree order creation failed ({(int)response.StatusCode}): {body}");

        using var doc = JsonDocument.Parse(body);
        var root = doc.RootElement;
        var cfOrderId = root.GetProperty("cf_order_id").ToString();
        var paymentSessionId = root.GetProperty("payment_session_id").GetString()!;

        return new CashfreeOrderResult(cfOrderId, paymentSessionId);
    }

    /// <summary>Refund is capped by the caller at what was actually captured on this order -
    /// this method just forwards the request. refundId must be unique per refund attempt.</summary>
    public async Task<CashfreeRefundResult> CreateRefundAsync(string orderId, decimal refundAmount, string refundId, string? note)
    {
        if (!IsConfigured)
            return new CashfreeRefundResult(false, null, "Cashfree is not configured.");

        var payload = new
        {
            refund_amount = refundAmount,
            refund_id = refundId,
            refund_note = note,
        };

        using var request = BuildRequest(HttpMethod.Post, $"/pg/orders/{orderId}/refunds", payload);
        var response = await _http.SendAsync(request);
        var body = await response.Content.ReadAsStringAsync();

        if (!response.IsSuccessStatusCode)
            return new CashfreeRefundResult(false, null, $"Cashfree refund failed ({(int)response.StatusCode}): {body}");

        using var doc = JsonDocument.Parse(body);
        var refundStatus = doc.RootElement.TryGetProperty("refund_status", out var statusEl) ? statusEl.GetString() : null;
        return new CashfreeRefundResult(true, refundStatus, null);
    }

    /// <summary>
    /// Cashfree's documented webhook algorithm: HMAC-SHA256 of (x-webhook-timestamp + the raw
    /// request body) using the client secret, base64-encoded, compared to x-webhook-signature.
    /// Must run against the exact raw bytes as received - re-serializing a parsed JSON object
    /// before hashing produces a different string and the signature will never match.
    /// </summary>
    public bool VerifyWebhookSignature(string rawBody, string timestamp, string signature)
    {
        var secret = _config["Cashfree:ClientSecret"];
        if (string.IsNullOrWhiteSpace(secret) || string.IsNullOrWhiteSpace(timestamp) || string.IsNullOrWhiteSpace(signature))
            return false;

        var signedPayload = timestamp + rawBody;
        using var hmac = new HMACSHA256(Encoding.UTF8.GetBytes(secret));
        var hash = hmac.ComputeHash(Encoding.UTF8.GetBytes(signedPayload));
        var computedSignature = Convert.ToBase64String(hash);

        // Constant-time comparison - this is a security check, not a UI diff.
        var computedBytes = Encoding.UTF8.GetBytes(computedSignature);
        var providedBytes = Encoding.UTF8.GetBytes(signature);
        return computedBytes.Length == providedBytes.Length &&
            CryptographicOperations.FixedTimeEquals(computedBytes, providedBytes);
    }

    private HttpRequestMessage BuildRequest(HttpMethod method, string path, object body)
    {
        var request = new HttpRequestMessage(method, path)
        {
            Content = new StringContent(JsonSerializer.Serialize(body), Encoding.UTF8, "application/json"),
        };
        request.Headers.Add("x-client-id", _config["Cashfree:ClientId"]);
        request.Headers.Add("x-client-secret", _config["Cashfree:ClientSecret"]);
        request.Headers.Add("x-api-version", ApiVersion);
        return request;
    }

    /// <summary>Cashfree wants a bare 10-digit Indian mobile number - strips anything else
    /// (a +91 prefix, spaces) down to the last 10 digits rather than trusting the stored format.</summary>
    private static string NormalizePhone(string phone)
    {
        var digits = new string(phone.Where(char.IsDigit).ToArray());
        return digits.Length > 10 ? digits[^10..] : digits;
    }
}
