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
    }

    private readonly ConcurrentDictionary<string, GatewayOrder> _orders = new();
    private readonly List<string> _createdOrderIds = [];

    /// <summary>Set to make order creation fail, for the rollback/502 paths.</summary>
    public bool FailOrderCreation { get; set; }

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
            return Json(HttpStatusCode.OK, """{"refund_status":"SUCCESS"}""");

        if (FailOrderCreation)
            return Json(HttpStatusCode.BadRequest, """{"message":"simulated failure"}""");

        return await CreateOrderAsync(request, cancellationToken);
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

    private HttpResponseMessage Payments(string path)
    {
        // /pg/orders/{cashfreeOrderId}/payments
        var segments = path.Split('/', StringSplitOptions.RemoveEmptyEntries);
        var cashfreeOrderId = segments.Length >= 2 ? segments[^2] : "";

        if (!_orders.TryGetValue(cashfreeOrderId, out var order) || order.PaymentStatus is null)
            return Json(HttpStatusCode.OK, "[]");

        return Json(HttpStatusCode.OK, $$"""
            [{"cf_payment_id":"{{order.CfPaymentId}}","payment_status":"{{order.PaymentStatus}}","payment_group":"{{order.PaymentGroup}}","payment_amount":{{order.Amount}}}]
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
