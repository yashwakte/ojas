using System.Security.Claims;
using System.Text;
using System.Text.Json;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.RateLimiting;
using OjasApi.Models;
using OjasApi.Services;

namespace OjasApi.Controllers;

/// <summary>
/// Server-to-server callbacks from payment gateways. Deliberately anonymous - Cashfree calls
/// this directly, never through a logged-in browser - and authenticated purely by the HMAC
/// signature on the request itself, not cookies or a bearer token.
/// </summary>
[ApiController]
[Route("api/[controller]")]
[AllowAnonymous]
[EnableRateLimiting("general")]
public class PaymentsController : ControllerBase
{
    private readonly CashfreeService _cashfreeService;
    private readonly OrderService _orderService;
    private readonly OrderPaymentOutcomeService _paymentOutcome;
    private readonly ILogger<PaymentsController> _logger;

    public PaymentsController(
        CashfreeService cashfreeService,
        OrderService orderService,
        OrderPaymentOutcomeService paymentOutcome,
        ILogger<PaymentsController> logger)
    {
        _cashfreeService = cashfreeService;
        _orderService = orderService;
        _paymentOutcome = paymentOutcome;
        _logger = logger;
    }

    /// <summary>Tells the browser which Cashfree environment to load its checkout SDK against.
    /// Anonymous and cacheable — it carries no secret, and the answer is the same for everybody.
    /// Having the server answer it is what makes going live a single change: flipping
    /// Cashfree:Environment moves the API and the browser together, instead of relying on a
    /// separately-deployed frontend constant being changed in the same breath.</summary>
    [HttpGet("cashfree/config")]
    public IActionResult GetCashfreeConfig()
    {
        // Short enough that flipping the environment takes effect within a minute, long enough
        // that a busy checkout page isn't asking on every visit.
        Response.Headers.CacheControl = "public, max-age=60";
        return Ok(new CashfreeConfigResponse(
            _cashfreeService.Mode, _cashfreeService.IsConfigured, _cashfreeService.FrontendBaseUrl));
    }

    /// <summary>Asks Cashfree directly how a payment went, for the customer who has just been
    /// redirected back from the hosted checkout page. Waiting for the webhook to arrive leaves
    /// them watching a spinner (and, before this existed, refreshing the page by hand); asking
    /// the gateway answers immediately. Still server-authoritative - the browser only names an
    /// order it owns, and the verdict comes from Cashfree, never from the redirect itself.</summary>
    [HttpGet("cashfree/status/{orderId}")]
    [Authorize]
    public async Task<IActionResult> GetCashfreePaymentStatus(string orderId)
    {
        var userId = User.FindFirstValue(ClaimTypes.NameIdentifier);
        if (userId == null) return Unauthorized();

        var order = await _orderService.GetOrderByIdAsync(orderId);
        if (order == null)
            return NotFound(new { message = "Order not found." });

        if (!string.Equals(order.UserId, userId, StringComparison.Ordinal))
            return Forbid();

        // The gateway order the customer's *own* order was raised against, as opposed to the
        // top-ups an edit charges separately. It is the order's own id, and the distinction is
        // load-bearing below: only this one going unpaid can stand the order down.
        var ownGatewayOrderId = orderId;
        var amendmentOrderId = order.PendingAmendment?.CashfreeOrderId;

        // The customer has just come back from paying one specific thing: the most recent gateway
        // order raised against this one. Its fate is what the banner has to report - the order's
        // own status answers a different question, and answering that one instead is how a top-up
        // left pending at the bank got announced as "payment successful".
        var latestAttempt = order.PaymentAttempts.Count > 0
            ? order.PaymentAttempts[^1].CashfreeOrderId
            : ownGatewayOrderId;

        // Already stood down, or settled with nothing newer to report on. Nothing outstanding to
        // ask Cashfree about, so answer from what we already know. Deliberately *not* taken when
        // the last thing the customer did was pay a top-up: the order being "Paid" says nothing
        // about how that top-up went, and answering with the order's own status there is what told
        // a customer who had just abandoned an edit that their payment was successful.
        if (order.PendingAmendment == null &&
            (string.Equals(order.Status, "Cancelled", StringComparison.OrdinalIgnoreCase) ||
             (order.PaymentStatus == "Paid" && latestAttempt == ownGatewayOrderId)))
        {
            return Ok(new CashfreePaymentStatusResponse(
                order.PaymentStatus, order.PaymentInstrument, false, order.PaymentFailureReason,
                order.ToResponse(),
                order.PaymentStatus == "Failed"
                    ? PaymentAttemptOutcomes.Failed
                    : order.PaymentStatus == "Paid"
                        ? PaymentAttemptOutcomes.Paid
                        : PaymentAttemptOutcomes.Discarded));
        }

        var anyRecorded = false;
        var lookups = new Dictionary<string, CashfreeOrderLookup>(StringComparer.Ordinal);

        foreach (var cashfreeOrderId in GatewayOrdersToCheck(order))
        {
            // One answer covering the gateway order's own status and every payment beneath it -
            // and, crucially, whether the asking worked at all. A read that failed used to look
            // exactly like an order nobody had paid, which is how a customer who had just paid was
            // told their payment never happened and had their order cancelled underneath them.
            var lookup = await _cashfreeService.LookUpAsync(cashfreeOrderId);
            lookups[cashfreeOrderId] = lookup;

            if (!lookup.Reachable)
            {
                _logger.LogWarning(
                    "Could not read Cashfree gateway order {CashfreeOrderId} for order {OrderId}. " +
                    "Nothing will be decided on this - the customer keeps whatever they have.",
                    cashfreeOrderId, orderId);
                continue;
            }

            // Ask Cashfree about the gateway order itself, not only the payments beneath it. When
            // an offer applies, the customer is charged less than the order was raised for and
            // Cashfree still reports it PAID - so the shortfall is a discount that settles the
            // order, not an amount the customer still owes.
            if (lookup.Order is { IsPaid: true } gatewayOrder)
            {
                var charged = lookup.Payments.Where(p => p.IsSuccess).Sum(p => p.Amount);
                anyRecorded |= await _orderService.TryRecordGatewayDiscountAsync(
                    orderId, cashfreeOrderId, gatewayOrder.OrderAmount - charged);
            }

            foreach (var payment in lookup.Payments.Where(p => p.IsSuccess))
            {
                // Recorded by Cashfree's payment id, so asking again - or a webhook arriving
                // for the same payment - can't count the same money twice.
                anyRecorded |= await _orderService.TryRecordPaymentAsync(orderId, new OrderPayment
                {
                    CfPaymentId = payment.CfPaymentId,
                    CashfreeOrderId = payment.CashfreeOrderId,
                    Amount = payment.Amount,
                    Instrument = payment.PaymentGroup,
                });
            }
        }

        // The customer is demonstrably back on our site. If the edit they went off to pay for has
        // no payment against it - not even one the bank is still deciding on - they left without
        // paying, so those changes are dropped now rather than hanging over the order. This is the
        // difference between an honest "nothing was charged, your order is unchanged" and the
        // customer being told to keep refreshing a page that will never resolve.
        //
        // A lookup we could not complete drops nothing. The customer keeps their pending edit and
        // the Pay button that goes with it, which is strictly better than throwing away changes
        // they may well have just paid for because the gateway was briefly unreachable.
        var amendmentDiscarded = false;
        if (amendmentOrderId != null &&
            lookups.TryGetValue(amendmentOrderId, out var amendmentLookup) &&
            amendmentLookup.Reachable)
        {
            if (amendmentLookup.IsPaid || amendmentLookup.AnyLive)
                await _paymentOutcome.ApplyIfPaidAsync(orderId);
            else
                amendmentDiscarded = await _paymentOutcome.DiscardAsync(orderId, amendmentOrderId);
        }

        var refreshed = await _orderService.RefreshPaymentStateAsync(orderId) ?? order;

        // The same reasoning applied to the order's *own* payment. An order the customer never
        // paid for shouldn't sit in their list saying "payment pending" forever, holding stock and
        // any wallet credit it spent - it has failed, and saying so is the only way they know to
        // try again.
        //
        // Three things have to line up before that happens, and every one of them is a positive
        // statement rather than an absence: the order holds no money of its own, Cashfree answered
        // when asked about the order's gateway order, and what it said was either "this is dead"
        // (expired, terminated, or every attempt failed) or "still open and nobody ever tried" -
        // which, for someone who has demonstrably come back from that page, means they walked
        // away. FailIfGatewayAgreesAsync then asks once more before acting.
        var settled = string.Equals(refreshed.PaymentStatus, "Paid", StringComparison.Ordinal);
        var ownLookup = lookups.GetValueOrDefault(ownGatewayOrderId);
        var ownIsFinished = ownLookup is { IsDefinitivelyUnpaid: true } or { OpenAndUnattempted: true };

        if (!settled && ownIsFinished &&
            !string.Equals(refreshed.Status, "Cancelled", StringComparison.OrdinalIgnoreCase))
        {
            var stoodDown = await _paymentOutcome.FailIfGatewayAgreesAsync(
                orderId, ownGatewayOrderId, ownLookup!.LastFailureReason ?? NotAttemptedReason);

            if (stoodDown)
            {
                var failed = await _orderService.GetOrderByIdAsync(orderId);
                return Ok(new CashfreePaymentStatusResponse(
                    "Failed", null, amendmentDiscarded, failed?.PaymentFailureReason,
                    failed?.ToResponse(), PaymentAttemptOutcomes.Failed));
            }

            // The confirmation disagreed - money has landed, or the gateway went quiet. Fall
            // through and report honestly rather than announcing a failure that was just refused.
            refreshed = await _orderService.RefreshPaymentStateAsync(orderId) ?? refreshed;
        }

        // A top-up whose changes are no longer pending is money we're holding for nothing.
        await _paymentOutcome.ReturnUnappliedOverpaymentAsync(orderId);
        refreshed = await _orderService.GetOrderByIdAsync(orderId) ?? refreshed;

        if (anyRecorded)
        {
            _logger.LogInformation(
                "Recorded payment(s) for order {OrderId} from a status check; now holding {Paid} of {Total}.",
                orderId, refreshed.AmountPaid, refreshed.TotalAmount);
        }

        // Reported against the attempt the customer just made, not the order as a whole. A bank
        // still deciding on a top-up leaves the order fully paid for what it currently holds, so
        // announcing "successful" there would invite them to pay a second time for the same change.
        var latest = lookups.GetValueOrDefault(latestAttempt);
        var latestFailureReason = latest?.LastFailureReason;
        var outcome =
            // Unreadable, so we genuinely do not know yet. "Keep checking" is the only honest
            // answer - never a success, and never a failure.
            latest is null or { Reachable: false } ? PaymentAttemptOutcomes.Pending
            : latest.IsPaid || latest.Payments.Any(p => p.IsSuccess) ? PaymentAttemptOutcomes.Paid
            : latest.AnyInFlight ? PaymentAttemptOutcomes.Pending
            : amendmentDiscarded ? PaymentAttemptOutcomes.Discarded
            : latestFailureReason != null ? PaymentAttemptOutcomes.Failed
            : latest.OpenAndUnattempted ? PaymentAttemptOutcomes.Discarded
            : PaymentAttemptOutcomes.Pending;

        return Ok(new CashfreePaymentStatusResponse(
            refreshed.PaymentStatus, refreshed.PaymentInstrument, amendmentDiscarded,
            refreshed.PaymentFailureReason ?? latestFailureReason, refreshed.ToResponse(), outcome));
    }

    /// <summary>
    /// Which gateway orders this check needs to ask Cashfree about.
    ///
    /// Always the order's own — its fate is the order's fate — plus the pending edit's and the one
    /// the customer has just come back from, since those are what the answer has to describe. Then
    /// the most recent few attempts, so a top-up that landed late is still picked up.
    ///
    /// Bounded on purpose. Every edit that raises a total adds an attempt permanently, and Get
    /// Payments is rate-limited per account (100/min), so an order edited a dozen times would
    /// otherwise turn one page load into a dozen gateway calls. Anything older than this window is
    /// still swept by the webhook and by the full reconciliation on the Pay path.
    /// </summary>
    private static IEnumerable<string> GatewayOrdersToCheck(Order order)
    {
        const int RecentAttempts = 3;

        var wanted = new List<string> { order.Id! };
        if (order.PendingAmendment?.CashfreeOrderId is { } amendment)
            wanted.Add(amendment);

        wanted.AddRange(order.PaymentAttempts
            .TakeLast(RecentAttempts)
            .Select(a => a.CashfreeOrderId));

        return wanted.Where(id => !string.IsNullOrWhiteSpace(id)).Distinct(StringComparer.Ordinal);
    }

    /// <summary>What to tell a customer who reached the payment page and left without picking a
    /// method at all - the gateway has no payment record to explain, because none was ever
    /// started. Saying their bank declined it would be inventing a reason.</summary>
    private const string NotAttemptedReason = "The payment wasn't completed.";

    /// <summary>The asynchronous backstop that marks an order Paid - never the customer's browser
    /// redirect, which proves nothing about whether the bank approved the charge. Matters most
    /// for the customer who closes the tab before landing back on the site. Reads the raw request
    /// body directly (rather than relying on model binding) since the signature must be verified
    /// against the exact bytes Cashfree sent, not a re-serialized copy.</summary>
    [HttpPost("cashfree/webhook")]
    public async Task<IActionResult> CashfreeWebhook()
    {
        Request.EnableBuffering();
        string rawBody;
        using (var reader = new StreamReader(Request.Body, Encoding.UTF8, leaveOpen: true))
        {
            rawBody = await reader.ReadToEndAsync();
        }
        Request.Body.Position = 0;

        var timestamp = Request.Headers["x-webhook-timestamp"].ToString();
        var signature = Request.Headers["x-webhook-signature"].ToString();

        if (!_cashfreeService.VerifyWebhookSignature(rawBody, timestamp, signature))
        {
            _logger.LogWarning("Rejected a Cashfree webhook with an invalid signature.");
            return Unauthorized();
        }

        // Every read of this payload is defensive, and deliberately so. The endpoint is registered
        // at webhook version 2025-01-01 while our API calls are pinned to 2023-08-01 — which is
        // legal, the two are configured independently — but Cashfree has published no field-level
        // delta between those versions, so the exact shape of what arrives here is not something
        // that can be known from the documentation. Tolerating an unexpected shape is therefore
        // the only defensible posture.
        //
        // It matters more than it looks: an exception escaping this method is a 500, Cashfree
        // reads a 500 as "not delivered" and retries indefinitely, and the retries arrive faster
        // than they are shed. One malformed payload used to be enough to start that. Anything we
        // cannot make sense of is acknowledged and logged instead, because retrying will not make
        // an unparseable body parseable.
        JsonDocument doc;
        try
        {
            doc = JsonDocument.Parse(rawBody);
        }
        catch (JsonException ex)
        {
            _logger.LogError(ex, "Cashfree sent a webhook body that is not JSON; acknowledging it.");
            return Ok();
        }

        using (doc)
        {
        var root = doc.RootElement;
        var type = root.TryGetProperty("type", out var typeElement) ? typeElement.GetString() : null;
        var cashfreeOrderId = WebhookOrderId(root);

        if (string.IsNullOrWhiteSpace(type) || string.IsNullOrWhiteSpace(cashfreeOrderId))
        {
            _logger.LogWarning(
                "A Cashfree webhook arrived without a type or an order id (type: {Type}). " +
                "Acknowledged - retrying would deliver the same thing.", type ?? "none");
            return Ok(); // Nothing to act on - acknowledge so Cashfree doesn't keep retrying.
        }

        // A top-up carries a suffixed Cashfree order id; both it and the original resolve back
        // to the same Ojas order.
        var orderId = CashfreeService.OjasOrderIdFrom(cashfreeOrderId);
        var isTopUp = !string.Equals(orderId, cashfreeOrderId, StringComparison.Ordinal);

        switch (type)
        {
            case "PAYMENT_SUCCESS_WEBHOOK":
            {
                var order = await _orderService.GetOrderByIdAsync(orderId);
                if (order == null) break;

                // The payment id is the whole basis of not counting money twice, so a success we
                // cannot identify is worse than useless - the status check will find that payment
                // by asking Cashfree directly, and record it exactly once.
                if (!TryGetNode(root, "data", "payment", out var payment) ||
                    !payment.TryGetProperty("cf_payment_id", out var idElement))
                {
                    _logger.LogError(
                        "A Cashfree success webhook for order {OrderId} carried no identifiable payment. " +
                        "Acknowledged; the status check will reconcile it.", orderId);
                    break;
                }

                // ToString rather than GetString: Cashfree made these ids strings in 2023-08-01,
                // but they were integers before it and this endpoint is registered at a different
                // version than our API calls use.
                var cfPaymentId = idElement.ToString();
                var instrument = payment.TryGetProperty("payment_group", out var group) ? group.GetString() : null;
                var amount = payment.TryGetProperty("payment_amount", out var amt) && amt.TryGetDecimal(out var parsed)
                    ? parsed
                    : order.TotalAmount;

                // Cashfree retries until it gets a 2xx, so the same success arrives more than
                // once. Recording by its payment id means the money lands exactly once, whether
                // it reaches us by webhook, by status check, or by both.
                var recorded = await _orderService.TryRecordPaymentAsync(orderId, new OrderPayment
                {
                    CfPaymentId = cfPaymentId,
                    CashfreeOrderId = cashfreeOrderId,
                    Amount = amount,
                    Instrument = instrument,
                });

                // Paying the top-up is what makes a pending edit real. Done before the state is
                // re-derived so the order's total is the amended one by the time it's judged.
                await _paymentOutcome.ApplyIfPaidAsync(orderId);

                var refreshed = await _orderService.RefreshPaymentStateAsync(orderId);

                // Money for changes that are no longer pending (the customer dropped them, or
                // they timed out while the bank was deciding) belongs back with the customer.
                await _paymentOutcome.ReturnUnappliedOverpaymentAsync(orderId);

                _logger.LogInformation(
                    "Cashfree {Kind} webhook for order {OrderId} ({CfPaymentId}, {Instrument}): {Outcome}, now holding {Paid} of {Total}.",
                    isTopUp ? "top-up" : "payment", orderId, cfPaymentId, instrument,
                    recorded ? "recorded" : "already known",
                    refreshed?.AmountPaid, refreshed?.TotalAmount);
                break;
            }
            case "REFUND_STATUS_WEBHOOK":
            {
                // Creating a refund only ever answers PENDING. The bank can reject it afterwards
                // — a closed account, a cancelled card — and the customer is then never credited.
                // Without this the order would go on showing money as handed back that it still
                // holds, which is the same lie as not refunding at all, only harder to notice.
                if (!TryGetNode(root, "data", "refund", out var refundNode))
                    break;

                var refundId = refundNode.TryGetProperty("refund_id", out var rid) ? rid.ToString() : null;
                var refundStatus = refundNode.TryGetProperty("refund_status", out var rst) ? rst.GetString() : null;

                if (string.IsNullOrWhiteSpace(refundId))
                    break;

                var bounced = await _orderService.RecordRefundOutcomeAsync(orderId, refundId, refundStatus);
                if (bounced is not { } amount)
                {
                    _logger.LogInformation(
                        "Cashfree refund {RefundId} on order {OrderId} is now {Status}.",
                        refundId, orderId, refundStatus);
                    break;
                }

                // The money never left, so the order holds it again — and it is owed to the
                // customer, so it goes back on the admin's list rather than quietly disappearing.
                await _orderService.ReleaseReservedRefundAsync(orderId, amount);
                var owed = await _orderService.GetOrderByIdAsync(orderId);
                await _orderService.SetRefundPendingAsync(
                    orderId, (owed?.RefundPendingAmount ?? 0m) + amount);
                await _orderService.RefreshPaymentStateAsync(orderId);

                _logger.LogError(
                    "Cashfree refund {RefundId} of {Amount} on order {OrderId} came back {Status} — the customer was not credited, and it is queued as owed.",
                    refundId, amount, orderId, refundStatus);
                break;
            }
            case "PAYMENT_FAILED_WEBHOOK":
            case "PAYMENT_USER_DROPPED_WEBHOOK":
            {
                // A failed top-up leaves the original order paid and intact - only the extra
                // items went unpaid, so cancelling the whole order here would be wrong. The edit
                // it was paying for is dropped, though: the changes were never bought, and the
                // stock they were holding goes back on the shelf. This is the path that catches
                // the customer who closed the tab rather than coming back to the site.
                if (isTopUp)
                {
                    var discarded = await _paymentOutcome.DiscardAsync(orderId, cashfreeOrderId);
                    _logger.LogInformation(
                        "Cashfree top-up failed/dropped for order {OrderId} - original order left untouched, pending changes {Outcome}.",
                        orderId, discarded ? "discarded" : "already gone");
                    break;
                }

                // The reason Cashfree gives is carried through verbatim so the customer is told
                // what actually happened. Standing the order down is itself guarded against
                // running twice, so Cashfree retrying this webhook is harmless.
                //
                // Cashfree is asked to confirm first, because one failed *attempt* is not a failed
                // order. A customer whose first try times out and who then pays on the same page
                // produces both a FAILED and a SUCCESS webhook, delivery order is not guaranteed,
                // and Cashfree retries until it gets a 2xx - so this callback routinely arrives
                // about an order that has since been paid for.
                var reason = WebhookFailureReason(root, type);
                if (!await _paymentOutcome.FailIfGatewayAgreesAsync(orderId, cashfreeOrderId, reason))
                {
                    _logger.LogInformation(
                        "Cashfree {Type} for order {OrderId} did not stand it down - the gateway says " +
                        "money is coming or has come, or it could not be reached.", type, orderId);
                }

                break;
            }
        }

        return Ok();
        }
    }

    /// <summary>Walks a nested object path, answering false rather than throwing at any step that
    /// is missing or is not an object. Every read of a webhook payload goes through this or
    /// TryGetProperty, because a shape we did not expect must never become a 500 - Cashfree reads
    /// that as a failed delivery and retries it forever.</summary>
    private static bool TryGetNode(JsonElement root, string first, string second, out JsonElement node)
    {
        node = default;
        if (root.ValueKind != JsonValueKind.Object ||
            !root.TryGetProperty(first, out var outer) ||
            outer.ValueKind != JsonValueKind.Object ||
            !outer.TryGetProperty(second, out var inner) ||
            inner.ValueKind != JsonValueKind.Object)
        {
            return false;
        }

        node = inner;
        return true;
    }

    /// <summary>The gateway order a webhook is about. Payment events carry it under data.order;
    /// a refund event need not, and carries it on the refund itself. Reading data.order blindly
    /// threw on a refund webhook, which Cashfree sees as a 500 and retries indefinitely.</summary>
    private static string? WebhookOrderId(JsonElement root)
    {
        // ValueKind is checked at every step, not just presence. TryGetProperty *throws* when the
        // element it is called on is not an object, so "data" arriving as a string - which is
        // exactly the kind of thing an unpublished version delta or an error page can produce -
        // would otherwise escape as a 500 and put Cashfree into an endless retry.
        if (TryGetNode(root, "data", "order", out var order) &&
            order.TryGetProperty("order_id", out var fromOrder))
        {
            return fromOrder.GetString();
        }

        return TryGetNode(root, "data", "refund", out var refund) &&
            refund.TryGetProperty("order_id", out var fromRefund)
                ? fromRefund.GetString()
                : null;
    }

    /// <summary>
    /// Digs the human-readable reason out of a failure webhook, so the customer is told what
    /// actually happened rather than a guess about banks.
    ///
    /// It looks for <c>error_details</c> in two places on purpose. Cashfree documents it under
    /// <c>data</c>, but nests it under <c>data.payment</c> in the payments API, and this endpoint
    /// is registered at a webhook version whose field-level differences Cashfree has never
    /// published. Checking both costs one lookup and is the difference between quoting the
    /// gateway and falling back to "the payment was declined" on a payload that told us exactly
    /// why. Display only, either way — nothing branches on this text.
    /// </summary>
    private static string WebhookFailureReason(JsonElement root, string? type)
    {
        if (string.Equals(type, "PAYMENT_USER_DROPPED_WEBHOOK", StringComparison.Ordinal))
            return "You left the payment page before the payment went through.";

        if (root.ValueKind != JsonValueKind.Object || !root.TryGetProperty("data", out var data))
            return DeclinedReason;

        data.TryGetProperty("payment", out var payment);

        foreach (var container in new[] { data, payment })
        {
            if (container.ValueKind == JsonValueKind.Object &&
                container.TryGetProperty("error_details", out var details) &&
                details.ValueKind == JsonValueKind.Object &&
                details.TryGetProperty("error_description", out var description) &&
                !string.IsNullOrWhiteSpace(description.GetString()))
            {
                return description.GetString()!.Trim();
            }
        }

        if (payment.ValueKind == JsonValueKind.Object &&
            payment.TryGetProperty("payment_message", out var message) &&
            !string.IsNullOrWhiteSpace(message.GetString()))
        {
            return message.GetString()!.Trim();
        }

        return DeclinedReason;
    }

    private const string DeclinedReason = "The payment was declined.";
}
