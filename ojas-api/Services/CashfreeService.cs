using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using OjasApi.Models;

namespace OjasApi.Services;

public record CashfreeOrderResult(string CfOrderId, string PaymentSessionId);

public record CashfreeRefundResult(bool Success, string? RefundStatus, string? Error);

/// <summary><paramref name="PaymentGroup"/> is Cashfree's payment_group - "upi", "credit_card",
/// "net_banking", "wallet" and so on - which is what tells the customer how they actually paid.
/// <paramref name="ErrorDescription"/> and <paramref name="PaymentMessage"/> are what the gateway
/// says went wrong; between them they are the difference between telling a customer the actual
/// reason their payment failed and guessing at one.</summary>
public record CashfreePaymentStatus(
	string PaymentStatus,
	string CfPaymentId,
	string? PaymentGroup,
	decimal Amount,
	string? CashfreeOrderId = null,
	string? PaymentMessage = null,
	string? ErrorDescription = null)
{
	/// <summary>Cashfree's terminal no-money outcomes. USER_DROPPED belongs here as much as
	/// FAILED does: a customer who walked away from the payment page is as finished as one whose
	/// card was declined, and treating it as still-in-progress is what leaves an order waiting on
	/// money that is never coming.</summary>
	private static readonly string[] TerminalFailureStatuses =
		["FAILED", "USER_DROPPED", "CANCELLED", "VOID", "NOT_ATTEMPTED"];

	public bool IsSuccess => string.Equals(PaymentStatus, "SUCCESS", StringComparison.OrdinalIgnoreCase);

	public bool IsFailed =>
		TerminalFailureStatuses.Contains(PaymentStatus, StringComparer.OrdinalIgnoreCase);

	/// <summary>Still being decided — a UPI collect request awaiting approval, a bank's 3-D Secure
	/// step. Anything we don't recognise counts as in-flight too, so an unfamiliar status errs
	/// towards waiting rather than towards throwing away a payment that might yet succeed.</summary>
	public bool IsInFlight => !IsSuccess && !IsFailed;

	/// <summary>What actually went wrong, in the gateway's own words where it gave any. The
	/// error description is preferred over the raw payment message because it is the field
	/// Cashfree writes for a human to read. Walking away from the page is reported as its own
	/// status rather than an error, so it is named here instead of being left blank — telling a
	/// customer their bank declined a payment they never attempted would be worse than useless.</summary>
	public string? FailureReason =>
		string.Equals(PaymentStatus, "USER_DROPPED", StringComparison.OrdinalIgnoreCase)
			? "You left the payment page before the payment went through."
			: FirstNonEmpty(ErrorDescription, PaymentMessage);

	private static string? FirstNonEmpty(params string?[] candidates) =>
		candidates.FirstOrDefault(c => !string.IsNullOrWhiteSpace(c))?.Trim();
}

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

    /// <summary>A Cashfree order id carries the Ojas order id plus, for a top-up, a uniquifying
    /// suffix (Cashfree rejects a reused order_id, and an order's amount can't be amended once
    /// created). Mongo ObjectIds are hex, so an underscore can never appear in the id itself,
    /// which makes the split unambiguous.</summary>
    public static string OjasOrderIdFrom(string cashfreeOrderId) => cashfreeOrderId.Split('_')[0];

    public static string TopUpOrderId(string ojasOrderId) =>
        $"{ojasOrderId}_{DateTime.UtcNow:yyyyMMddHHmmssfff}";

    /// <summary>Creates the order on Cashfree's side for an amount computed server-side - the
    /// browser never supplies a price. Returns the payment_session_id the frontend's checkout SDK
    /// needs to open the hosted payment page. <paramref name="cashfreeOrderId"/> defaults to the
    /// Ojas order id; a top-up passes a suffixed one from <see cref="TopUpOrderId"/>.</summary>
    public async Task<CashfreeOrderResult> CreateOrderAsync(Order order, decimal? amount = null, string? cashfreeOrderId = null)
    {
        if (!IsConfigured)
            throw new InvalidOperationException("Cashfree is not configured (Cashfree:ClientId / Cashfree:ClientSecret missing).");

        var payload = new
        {
            order_id = cashfreeOrderId ?? order.Id,
            order_amount = amount ?? order.TotalAmount,
            order_currency = "INR",
            customer_details = new
            {
                customer_id = order.UserId ?? order.Id,
                customer_name = order.FullName,
                customer_phone = NormalizePhone(order.Phone),
            },
            order_meta = new
            {
                // Names the Ojas order, not this gateway order: the status check examines every
                // gateway order recorded against it, so a top-up is found whichever one the
                // customer just paid. Informational either way - landing here never marks
                // anything paid; only a verified webhook or a server-side status query does.
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

    /// <summary>Asks Cashfree directly what happened to a payment, rather than waiting for the
    /// webhook to arrive. The webhook is still the backstop for a customer who closes the tab,
    /// but polling our own database for it means the customer stares at a spinner until it
    /// lands - querying the gateway answers immediately when they get back from checkout.</summary>
    public async Task<List<CashfreePaymentStatus>> GetPaymentsAsync(string cashfreeOrderId)
    {
        if (!IsConfigured)
            return [];

        using var request = BuildRequest(HttpMethod.Get, $"/pg/orders/{cashfreeOrderId}/payments", null);
        var response = await _http.SendAsync(request);
        var body = await response.Content.ReadAsStringAsync();

        if (!response.IsSuccessStatusCode)
            return [];

        using var doc = JsonDocument.Parse(body);
        if (doc.RootElement.ValueKind != JsonValueKind.Array)
            return [];

        // Every attempt is returned, not just the winner: one gateway order can hold a failed
        // card try and then a successful UPI one. The caller records the successes by id and
        // decides what the set means, rather than this guessing on its behalf.
        var payments = new List<CashfreePaymentStatus>();
        foreach (var element in doc.RootElement.EnumerateArray())
        {
            payments.Add(new CashfreePaymentStatus(
                element.TryGetProperty("payment_status", out var s) ? s.GetString() ?? "" : "",
                element.TryGetProperty("cf_payment_id", out var p) ? p.ToString() : "",
                element.TryGetProperty("payment_group", out var g) ? g.GetString() : null,
                element.TryGetProperty("payment_amount", out var a) && a.TryGetDecimal(out var amt) ? amt : 0m,
                cashfreeOrderId,
                element.TryGetProperty("payment_message", out var m) ? m.GetString() : null,
                ErrorDescriptionOf(element)));
        }

        return payments;
    }

    /// <summary>Cashfree nests the human-readable failure text under error_details; it is absent
    /// entirely on a successful payment.</summary>
    private static string? ErrorDescriptionOf(JsonElement payment) =>
        payment.TryGetProperty("error_details", out var details) &&
        details.ValueKind == JsonValueKind.Object &&
        details.TryGetProperty("error_description", out var description)
            ? description.GetString()
            : null;

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

    private HttpRequestMessage BuildRequest(HttpMethod method, string path, object? body)
    {
        var request = new HttpRequestMessage(method, path);
        if (body is not null)
            request.Content = new StringContent(JsonSerializer.Serialize(body), Encoding.UTF8, "application/json");
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
