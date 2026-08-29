using System.Collections.Concurrent;
using System.Net;
using System.Text;
using System.Text.Json;
using Microsoft.Extensions.Configuration;
using OjasApi.Services;

namespace OjasApi.Tests.TestHelpers;

/// <summary>
/// Stands in for Cashfree's HTTP API so tests exercise the real <see cref="CashfreeService"/>
/// (its request building, response parsing and signature verification) without a network call.
///
/// It keeps per-gateway-order state rather than one canned response, because that distinction is
/// the whole point: an edit that raises an order's total is charged as a *separate* gateway order,
/// and a fake that answered the same way for every id would hide a top-up going unrecorded.
/// </summary>
public sealed class FakeCashfreeHandler : HttpMessageHandler
{
    public const string ClientId = "test-client-id";
    public const string ClientSecret = "test-cashfree-secret";

    private sealed record GatewayOrder(decimal Amount)
    {
        public string? PaymentStatus { get; set; }
        public string PaymentGroup { get; set; } = "upi";
        public string CfPaymentId { get; } = $"cf_pay_{Guid.NewGuid():N}";

        /// <summary>Knocked off by an offer on Cashfree's own page, so the customer is charged
        /// less than the order was raised for while Cashfree still reports the order PAID.</summary>
        public decimal Discount { get; set; }
    }

    private readonly ConcurrentDictionary<string, GatewayOrder> _orders = new();
    private readonly List<string> _createdOrderIds = [];

    /// <summary>Set to make order creation fail, for the rollback/502 paths.</summary>
    public bool FailOrderCreation { get; set; }

    /// <summary>Set to make every refund be refused, so the "the payout didn't go through" path
    /// is exercised rather than assumed.</summary>
    public bool FailRefunds { get; set; }

    private readonly List<(string GatewayOrderId, decimal Amount)> _refunds = [];

    /// <summary>Every refund we asked the gateway for, and crucially <em>which gateway order</em>
    /// each was raised against. That is what proves a refund on a topped-up order is split across
    /// the legs holding the money instead of all being aimed at the original id, where it would
    /// take too much from the first payment and miss the top-up entirely.</summary>
    public IReadOnlyList<(string GatewayOrderId, decimal Amount)> Refunds
    {
        get { lock (_refunds) return _refunds.ToList(); }
    }

    /// <summary>Gateway order ids in the order they were created — the first is the original
    /// payment, any others are top-ups. Kept as its own list because a ConcurrentDictionary's
    /// keys come back in no particular order, which made "the top-up is the last one" a coin
    /// flip rather than a fact.</summary>
    public IReadOnlyList<string> CreatedOrderIds
    {
        get { lock (_createdOrderIds) return _createdOrderIds.ToList(); }
    }

    /// <summary>Simulates the customer completing payment for every gateway order raised so far,
    /// which is what returning from the hosted checkout page means.</summary>
    public void PayAllOutstanding(string paymentGroup = "upi")
    {
        foreach (var order in _orders.Values.Where(o => o.PaymentStatus is null))
        {
            order.PaymentStatus = "SUCCESS";
            order.PaymentGroup = paymentGroup;
        }
    }

    /// <summary>Simulates a payment the bank has not finished deciding on - a UPI collect
    /// awaiting approval. Cashfree reports it as PENDING: no money yet, and not a failure either.
    /// This is the state the sandbox simulator offers, and the one that used to be announced to
    /// the customer as a success.</summary>
    public void LeaveAllOutstandingPending()
    {
        foreach (var order in _orders.Values.Where(o => o.PaymentStatus is null))
            order.PaymentStatus = "PENDING";
    }

    /// <summary>The bank making up its mind about a payment left pending — the other half of
    /// <see cref="LeaveAllOutstandingPending"/>, which on its own can only ever stay pending.</summary>
    public void SettlePending(bool succeeded = true)
    {
        foreach (var order in _orders.Values.Where(o => o.PaymentStatus == "PENDING"))
            order.PaymentStatus = succeeded ? "SUCCESS" : "FAILED";
    }

    /// <summary>Simulates a Cashfree offer being applied at the payment page: the customer is
    /// charged <paramref name="discount"/> less than the order was raised for, and Cashfree still
    /// reports the gateway order as PAID. This is the case that used to leave an order stuck at
    /// PartiallyPaid, telling the customer to pay a difference already discounted away.</summary>
    public void ApplyOfferToAllOutstanding(decimal discount)
    {
        foreach (var order in _orders.Values.Where(o => o.PaymentStatus is null))
            order.Discount = discount;
    }

    /// <summary>Simulates the customer's payment being declined.</summary>
    public void FailAllOutstanding()
    {
        foreach (var order in _orders.Values.Where(o => o.PaymentStatus is null))
            order.PaymentStatus = "FAILED";
    }

    protected override async Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancellationToken)
    {
        var path = request.RequestUri!.AbsolutePath;

        if (path.EndsWith("/payments", StringComparison.Ordinal))
            return Payments(path);

        if (path.EndsWith("/refunds", StringComparison.Ordinal))
            return await RefundAsync(path, request, cancellationToken);

        // Route on the method as well as the path, the way Cashfree actually does. Treating every
        // unrecognised request as an order creation meant a GET of an order's status silently
        // minted a brand new gateway order here - which is a fiction no real gateway would allow,
        // and it made the double disagree with the thing it stands in for.
        if (request.Method == HttpMethod.Get)
            return OrderStatus(path);

        if (FailOrderCreation)
            return Json(HttpStatusCode.BadRequest, """{"message":"simulated failure"}""");

        return await CreateOrderAsync(request, cancellationToken);
    }

    /// <summary>GET /pg/orders/{id} - Cashfree's own verdict on the gateway order, which is
    /// authoritative in a way the sum of its payments is not once an offer is involved.</summary>
    private HttpResponseMessage OrderStatus(string path)
    {
        var id = path[(path.LastIndexOf('/') + 1)..];
        if (!_orders.TryGetValue(id, out var order))
            return Json(HttpStatusCode.NotFound, """{"message":"order not found"}""");

        var status = order.PaymentStatus switch
        {
            "SUCCESS" => "PAID",
            "PENDING" => "ACTIVE",
            "FAILED" => "ACTIVE",
            _ => "ACTIVE",
        };

        var amount = order.Amount.ToString(System.Globalization.CultureInfo.InvariantCulture);
        return Json(HttpStatusCode.OK, $$"""
            {"order_id":"{{id}}","order_status":"{{status}}","order_amount":{{amount}}}
            """);
    }

    private async Task<HttpResponseMessage> CreateOrderAsync(HttpRequestMessage request, CancellationToken cancellationToken)
    {
        var body = request.Content is null ? "{}" : await request.Content.ReadAsStringAsync(cancellationToken);
        using var doc = JsonDocument.Parse(body);
        var root = doc.RootElement;

        var orderId = root.TryGetProperty("order_id", out var id) ? id.GetString() ?? "" : "";
        var amount = root.TryGetProperty("order_amount", out var amt) && amt.TryGetDecimal(out var parsed)
            ? parsed
            : 0m;

        _orders[orderId] = new GatewayOrder(amount);
        lock (_createdOrderIds) _createdOrderIds.Add(orderId);

        return Json(
            HttpStatusCode.OK,
            $$"""{"cf_order_id":"cf_{{orderId}}","payment_session_id":"session_{{orderId}}","order_status":"ACTIVE"}""");
    }

    /// <summary>POST /pg/orders/{id}/refunds — records what was asked for against which gateway
    /// order, since a refund is raised against a gateway order and not against our own order id.</summary>
    private async Task<HttpResponseMessage> RefundAsync(
        string path, HttpRequestMessage request, CancellationToken cancellationToken)
    {
        if (FailRefunds)
            return Json(HttpStatusCode.BadRequest, """{"message":"simulated refund failure"}""");

        var segments = path.Split('/', StringSplitOptions.RemoveEmptyEntries);
        var gatewayOrderId = segments.Length >= 2 ? segments[^2] : "";

        var body = request.Content is null ? "{}" : await request.Content.ReadAsStringAsync(cancellationToken);
        using var doc = JsonDocument.Parse(body);
        var amount = doc.RootElement.TryGetProperty("refund_amount", out var amt) && amt.TryGetDecimal(out var parsed)
            ? parsed
            : 0m;

        lock (_refunds) _refunds.Add((gatewayOrderId, amount));

        return Json(HttpStatusCode.OK, """{"refund_status":"SUCCESS"}""");
    }

    private HttpResponseMessage Payments(string path)
    {
        // /pg/orders/{cashfreeOrderId}/payments
        var segments = path.Split('/', StringSplitOptions.RemoveEmptyEntries);
        var cashfreeOrderId = segments.Length >= 2 ? segments[^2] : "";

        if (!_orders.TryGetValue(cashfreeOrderId, out var order) || order.PaymentStatus is null)
            return Json(HttpStatusCode.OK, "[]");

        // payment_amount is what the CUSTOMER was charged, which an offer makes smaller than the
        // amount the order was raised for. That gap is the whole point of the discount handling.
        var charged = order.Amount - order.Discount;

        return Json(HttpStatusCode.OK, $$"""
            [{"cf_payment_id":"{{order.CfPaymentId}}","payment_status":"{{order.PaymentStatus}}","payment_group":"{{order.PaymentGroup}}","payment_amount":{{charged}}}]
            """);
    }

    private static HttpResponseMessage Json(HttpStatusCode status, string body) =>
        new(status) { Content = new StringContent(body, Encoding.UTF8, "application/json") };

    public static IConfiguration Configuration() =>
        new ConfigurationBuilder()
            .AddInMemoryCollection(new Dictionary<string, string?>
            {
                ["Cashfree:Environment"] = "sandbox",
                ["Cashfree:ClientId"] = ClientId,
                ["Cashfree:ClientSecret"] = ClientSecret,
                ["Frontend:BaseUrl"] = "https://ojas.test",
            })
            .Build();

    public CashfreeService Service() => new(new HttpClient(this), Configuration());
}
