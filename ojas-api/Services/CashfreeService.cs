using System.Globalization;
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
/// <summary>Cashfree's own verdict on a gateway order: whether it considers it paid, and the
/// amount it was raised for. Authoritative in a way the sum of its payments is not, because an
/// offer can settle an order for less than the customer was charged.</summary>
public record CashfreeOrderStatus(string Status, decimal OrderAmount, string CashfreeOrderId)
{
    public bool IsPaid => string.Equals(Status, "PAID", StringComparison.OrdinalIgnoreCase);

    /// <summary>The payment link is still open, so the customer can still pay against it. An
    /// order in this state has emphatically <em>not</em> failed, however few payments sit under
    /// it — which is the whole difference between "they haven't paid yet" and "they never will".</summary>
    public bool IsOpen => string.Equals(Status, "ACTIVE", StringComparison.OrdinalIgnoreCase);

    /// <summary>Cashfree's terminal states for the order itself: the window closed, or we (or
    /// Cashfree) killed it. Nothing further can ever be collected against it.</summary>
    public bool IsDead =>
        string.Equals(Status, "EXPIRED", StringComparison.OrdinalIgnoreCase) ||
        string.Equals(Status, "TERMINATED", StringComparison.OrdinalIgnoreCase);
}

/// <summary>
/// What we know about one gateway order after asking Cashfree about it — <em>including whether
/// the asking worked</em>.
///
/// That last part is the point of this type existing. Both lookups used to answer an empty list
/// or a null on any non-2xx, which made "Cashfree says this order has no payments" and "Cashfree
/// did not answer us" the same value. The caller then stood the customer's order down for want of
/// evidence, so one 429, one 502, one DNS blip during a deploy, or one three-second timeout
/// cancelled an order that had been paid for. Money the gateway is holding must never be written
/// off because of a failed read: silence is not a "no".
/// </summary>
/// <param name="Reachable">False when the lookup itself failed — a network error, a timeout, or
/// any non-success response. Everything else in the record is then meaningless.</param>
public record CashfreeOrderLookup(
    bool Reachable,
    CashfreeOrderStatus? Order,
    List<CashfreePaymentStatus> Payments)
{
    public static CashfreeOrderLookup Unreachable => new(false, null, []);

    public bool IsPaid => Order is { IsPaid: true };

    /// <summary>Money may still arrive against this gateway order: something succeeded, or a bank
    /// is still deciding. Never true for an unreachable lookup — a caller deciding whether it is
    /// safe to raise a <em>second</em> payment has to hear "don't know" as "don't".</summary>
    public bool AnyLive => Reachable && Payments.Any(p => p.IsSuccess || p.IsInFlight);

    public bool AnyInFlight => Reachable && Payments.Any(p => p.IsInFlight);

    /// <summary>Cashfree has given a definitive "no money is coming from this one". Either every
    /// attempt against it terminally failed, or the order itself expired or was terminated.
    /// Deliberately false when unreachable, and false while the order is still ACTIVE with
    /// nothing attempted — that customer simply hasn't paid <em>yet</em>.</summary>
    public bool IsDefinitivelyUnpaid =>
        Reachable && !IsPaid && !AnyLive &&
        (Order is { IsDead: true } || Payments.Any(p => p.IsFailed));

    /// <summary>True when Cashfree answered, the payment link is still open, and nobody has ever
    /// tried to pay against it. Not a failure on its own — but a customer who has demonstrably
    /// come back to our site from that page has finished with it.</summary>
    public bool OpenAndUnattempted =>
        Reachable && !IsPaid && Payments.Count == 0 && Order is { IsOpen: true };

    public string? LastFailureReason =>
        Payments.LastOrDefault(p => p.IsFailed && p.FailureReason != null)?.FailureReason;
}

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

    /// <summary>
    /// How request bodies are serialized for Cashfree.
    ///
    /// The encoder is the point. <c>System.Text.Json</c> defaults to an HTML-safe encoder that
    /// escapes <c>+</c>, <c>&amp;</c>, <c>&lt;</c>, <c>'</c> and every non-ASCII character as
    /// <c>\uXXXX</c>. That is correct JSON and the right default for output that might land in a
    /// page — but this body goes straight to an API, and Cashfree validates some fields as raw
    /// strings without decoding the escapes first. A timestamp ending <c>+00:00</c> was rejected
    /// for exactly that reason, and the same trap sits under any customer whose name contains an
    /// apostrophe or whose address contains an ampersand.
    ///
    /// "Unsafe" here means only "not pre-escaped for HTML". Quotes, backslashes and control
    /// characters are still escaped, so the output remains valid JSON.
    /// </summary>
    private static readonly JsonSerializerOptions WireJson = new()
    {
        Encoder = System.Text.Encodings.Web.JavaScriptEncoder.UnsafeRelaxedJsonEscaping,
    };

    private readonly HttpClient _http;
    private readonly IConfiguration _config;
    private readonly bool _isSandbox;

    public CashfreeService(HttpClient http, IConfiguration config)
    {
        _config = config;
        _isSandbox = IsSandboxEnvironment(config);
        http.BaseAddress = new Uri(_isSandbox ? "https://sandbox.cashfree.com" : "https://api.cashfree.com");
        _http = http;
    }

    /// <summary>Anything that isn't explicitly "production" is sandbox, so a missing or misspelt
    /// setting can never point live credentials at real money by accident.</summary>
    public static bool IsSandboxEnvironment(IConfiguration config) =>
        !string.Equals(config["Cashfree:Environment"], "production", StringComparison.OrdinalIgnoreCase);

    /// <summary>Refuses to start when the credentials and the environment disagree — in either
    /// direction. Going live means changing three environment variables together, and this is
    /// what stops it being done halfway: keys sent to the wrong gateway authenticate against
    /// nothing, so <em>every</em> payment on the site fails, and a deploy log is a far better
    /// place to find that out than a customer's checkout. Cashfree prefixes its sandbox client
    /// id with TEST, which is what makes the mismatch detectable at all.
    ///
    /// Missing credentials are deliberately not fatal: the gateway already degrades to a clear
    /// "payments unavailable", and taking the whole storefront down with it would be worse.</summary>
    public static void EnsureCredentialsMatchEnvironment(IConfiguration config)
    {
        var clientId = config["Cashfree:ClientId"];
        if (string.IsNullOrWhiteSpace(clientId)) return;

        var isSandboxKey = clientId.StartsWith("TEST", StringComparison.OrdinalIgnoreCase);
        var isSandboxEnvironment = IsSandboxEnvironment(config);
        if (isSandboxKey == isSandboxEnvironment) return;

        throw new InvalidOperationException(isSandboxEnvironment
            // The likelier of the two on a deploy: the live keys were pasted in from the Cashfree
            // dashboard and Cashfree:Environment was left behind. Nothing defaults it to
            // production - the deployed API is configured entirely from environment variables,
            // and the setting that isn't set is the one nobody remembers.
            ? "Cashfree:ClientId is a live key but Cashfree:Environment is not 'production', so " +
              "the live credentials would be sent to the sandbox gateway. Set " +
              "Cashfree:Environment to 'production'."
            : "Cashfree:Environment is 'production' but Cashfree:ClientId is a sandbox (TEST) key. " +
              "Set the live credentials, or set Cashfree:Environment back to 'sandbox'.");
    }

    /// <summary>The mode the checkout SDK in the browser has to be loaded in. A payment session
    /// created against one environment simply will not open in the other, and the two used to be
    /// configured independently - the API from Render's env vars, the browser from a constant
    /// baked into the bundle - so a deploy that changed one and not the other broke every
    /// payment. The browser asks the server which one it is instead.</summary>
    public string Mode => _isSandbox ? "sandbox" : "production";

    public bool IsConfigured =>
        !string.IsNullOrWhiteSpace(_config["Cashfree:ClientId"]) &&
        !string.IsNullOrWhiteSpace(_config["Cashfree:ClientSecret"]);

    /// <summary>The origin a paying customer is handed back to. Trailing slash removed because it
    /// is concatenated with a path, and a doubled slash in a return_url is the sort of thing a
    /// gateway or a proxy quietly normalises differently from us.</summary>
    public string FrontendBaseUrl => (_config["Frontend:BaseUrl"] ?? string.Empty).TrimEnd('/');

    /// <summary>A Cashfree order id carries the Ojas order id plus, for a top-up, a uniquifying
    /// suffix (Cashfree rejects a reused order_id, and an order's amount can't be amended once
    /// created). Mongo ObjectIds are hex, so an underscore can never appear in the id itself,
    /// which makes the split unambiguous.</summary>
    public static string OjasOrderIdFrom(string cashfreeOrderId) => cashfreeOrderId.Split('_')[0];

    public static string TopUpOrderId(string ojasOrderId) =>
        $"{ojasOrderId}_{DateTime.UtcNow:yyyyMMddHHmmssfff}";

    /// <summary>
    /// How long a payment link stays open. Deliberately the same window an unpaid edit is held
    /// for (<see cref="OrderService.AmendmentLifetime"/>), so a top-up's gateway order and the
    /// changes it is paying for die together rather than one outliving the other.
    ///
    /// Setting this at all is what gives us an <em>authoritative</em> dead end. Left unset,
    /// Cashfree keeps an order ACTIVE for weeks, so "has this been abandoned?" could only ever be
    /// inferred from the absence of payments — and inferring a failure from absence is precisely
    /// what cancelled orders that had in fact been paid for. An EXPIRED order is Cashfree saying
    /// so itself. It also closes the other end of that: a session left open for weeks is a
    /// customer who can pay, tomorrow, for an order we stood down today.
    /// </summary>
    public static readonly TimeSpan PaymentWindow = TimeSpan.FromMinutes(30);

    /// <summary>
    /// An instant as the ISO-8601 string Cashfree requires — in UTC, with a trailing <c>Z</c>.
    ///
    /// Two separate faults had to be fixed here, and both stopped every order on the site being
    /// placed, so both are worth stating.
    ///
    /// <para>The first is the locale. In a .NET custom format string <c>:</c> is not a literal
    /// colon, it is a <em>placeholder for the current culture's time separator</em>. Under
    /// <c>en-IN</c> — an entirely ordinary locale for this business — that is a full stop, so
    /// <c>HH:mm:ss</c> rendered <c>18.00.33</c>. Hence the escaped colons and the pinned culture:
    /// either alone is sufficient, and having both means it cannot come back if someone later
    /// removes one, reasonably assuming a colon in a format string is a colon.</para>
    ///
    /// <para>The second is subtler and is why this ends in <c>Z</c> rather than an offset.
    /// <c>System.Text.Json</c>'s default encoder escapes <c>+</c> as <c>+</c>, so a perfectly
    /// well-formed <c>…+00:00</c> went onto the wire as <c>…+00:00</c> — still valid JSON,
    /// but Cashfree validates the raw string without decoding the escape and rejects it. Emitting
    /// UTC as <c>Z</c> is what Cashfree's own error message gives as the example, and it contains
    /// no character any encoder wants to touch. (<see cref="BuildRequest"/> also stops the
    /// needless escaping at source, which matters for names and addresses; this belt-and-braces
    /// keeps the field safe regardless of how the request is later serialized.)</para>
    /// </summary>
    internal static string FormatExpiry(DateTimeOffset moment) =>
        moment.ToUniversalTime().ToString("yyyy-MM-dd'T'HH':'mm':'ss'Z'", CultureInfo.InvariantCulture);

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
                return_url = $"{FrontendBaseUrl}/my-orders?cashfreeOrderId={order.Id}",
            },
            // ISO-8601 with an offset, which is the format Cashfree documents. Past this moment
            // the gateway order goes EXPIRED, which is a definite answer we can act on instead of
            // guessing from silence - see PaymentWindow. The 'T' and the culture are both pinned:
            // an unquoted T is not a custom format specifier, and a server running under a
            // non-Gregorian calendar would otherwise render a date Cashfree rejects - which would
            // break not one payment but every payment.
            order_expiry_time = FormatExpiry(DateTimeOffset.UtcNow.Add(PaymentWindow)),
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
    /// <summary>
    /// Asks Cashfree about the gateway order itself, rather than about the payments under it.
    ///
    /// The distinction matters whenever an offer is in play. <c>payment_amount</c> is what the
    /// customer was charged; <c>order_amount</c> is what the order was raised for. A bank offer or
    /// a promo code entered on Cashfree's page makes the first smaller than the second while
    /// Cashfree still reports <c>order_status: PAID</c> - so summing payments understates what the
    /// order is settled for, and the customer is told they still owe the difference. Cashfree is
    /// the authority on whether the order it created was paid; this is how we ask it.
    /// </summary>
    /// <summary>
    /// Everything Cashfree knows about one gateway order, in a single answer: the order's own
    /// status and every payment attempted against it, plus whether the asking actually worked.
    ///
    /// Callers should prefer this over the two lookups below. Deciding an order's fate needs both
    /// halves anyway — the order status is the authority on <em>paid</em>, the payments are the
    /// authority on <em>failed</em> and <em>in flight</em> — and taking them together means a
    /// caller cannot accidentally trust one while the other silently failed to load.
    /// </summary>
    public async Task<CashfreeOrderLookup> LookUpAsync(string cashfreeOrderId)
    {
        if (!IsConfigured || string.IsNullOrWhiteSpace(cashfreeOrderId))
            return CashfreeOrderLookup.Unreachable;

        var payments = await TryGetPaymentsAsync(cashfreeOrderId);
        if (payments == null)
            return CashfreeOrderLookup.Unreachable;

        var order = await GetOrderStatusAsync(cashfreeOrderId);
        // Reached the payments endpoint but not the order one: something is wrong with the
        // gateway right now, and half an answer is exactly the sort of partial evidence that got
        // paid orders cancelled. Wait and ask again rather than deciding on it.
        return order == null
            ? CashfreeOrderLookup.Unreachable
            : new CashfreeOrderLookup(true, order, payments);
    }

    public async Task<CashfreeOrderStatus?> GetOrderStatusAsync(string cashfreeOrderId)
    {
        if (!IsConfigured || string.IsNullOrWhiteSpace(cashfreeOrderId))
            return null;

        var body = await SendForBodyAsync(HttpMethod.Get, $"/pg/orders/{cashfreeOrderId}");
        if (body == null)
            return null;

        using var doc = JsonDocument.Parse(body);
        var root = doc.RootElement;
        if (root.ValueKind != JsonValueKind.Object) return null;

        return new CashfreeOrderStatus(
            root.TryGetProperty("order_status", out var st) ? st.GetString() ?? "" : "",
            root.TryGetProperty("order_amount", out var amt) && amt.TryGetDecimal(out var a) ? a : 0m,
            cashfreeOrderId);
    }

    /// <summary>The payments under a gateway order, or an empty list when they could not be
    /// fetched. Kept for callers that only report; anything that <em>decides</em> should use
    /// <see cref="LookUpAsync"/>, which says whether the answer is real.</summary>
    public async Task<List<CashfreePaymentStatus>> GetPaymentsAsync(string cashfreeOrderId) =>
        await TryGetPaymentsAsync(cashfreeOrderId) ?? [];

    /// <summary>Null means the lookup failed, which is emphatically not the same as an order with
    /// no payments on it.</summary>
    private async Task<List<CashfreePaymentStatus>?> TryGetPaymentsAsync(string cashfreeOrderId)
    {
        if (!IsConfigured || string.IsNullOrWhiteSpace(cashfreeOrderId))
            return null;

        var body = await SendForBodyAsync(HttpMethod.Get, $"/pg/orders/{cashfreeOrderId}/payments");
        if (body == null)
            return null;

        using var doc = JsonDocument.Parse(body);
        // A gateway order nobody has tried to pay answers with an empty array, so this is the one
        // shape that legitimately means "no payments" rather than "no answer".
        if (doc.RootElement.ValueKind != JsonValueKind.Array)
            return null;

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

    /// <summary>
    /// A read against Cashfree, answering the response body or <c>null</c> if we did not get one.
    ///
    /// Every way a read can fail collapses to that single null: a non-2xx status, a socket error,
    /// a DNS failure mid-deploy, a timeout, a body that is not JSON at all (Cashfree's edge
    /// answers HTML on some outages, and parsing that used to throw a 500 out of the controller).
    /// Callers must treat null as "ask again later" and never as "there is nothing there" — that
    /// conflation is what cancelled paid orders.
    /// </summary>
    private async Task<string?> SendForBodyAsync(HttpMethod method, string path)
    {
        try
        {
            using var request = BuildRequest(method, path, null);
            using var response = await _http.SendAsync(request);
            var body = await response.Content.ReadAsStringAsync();

            if (!response.IsSuccessStatusCode)
                return null;

            // Guard the parse here so a malformed body is a failed read rather than an exception
            // escaping into a request that was only ever asking a question.
            try
            {
                using var _ = JsonDocument.Parse(body);
            }
            catch (JsonException)
            {
                return null;
            }

            return body;
        }
        catch (Exception ex) when (ex is HttpRequestException or TaskCanceledException or IOException)
        {
            return null;
        }
    }

    private HttpRequestMessage BuildRequest(HttpMethod method, string path, object? body)
    {
        var request = new HttpRequestMessage(method, path);
        if (body is not null)
            request.Content = new StringContent(JsonSerializer.Serialize(body, WireJson), Encoding.UTF8, "application/json");
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
