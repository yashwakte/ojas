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

        // Already settled or already stood down, with no unpaid edit riding on it - nothing
        // outstanding to ask Cashfree about. The stored failure reason comes back too, so a
        // customer returning to an order that already failed still gets told why.
        if (order.PendingAmendment == null && (order.PaymentStatus == "Paid" || order.Status == "Cancelled"))
            return Ok(new CashfreePaymentStatusResponse(
                order.PaymentStatus, order.PaymentInstrument, false, order.PaymentFailureReason,
                order.ToResponse(),
                order.PaymentStatus == "Failed"
                    ? PaymentAttemptOutcomes.Failed
                    : PaymentAttemptOutcomes.Paid));

        // Every gateway order recorded against this one, not just the first: an edit that raised
        // the total is charged as its own gateway order, and asking only about the original is
        // exactly how a paid top-up ends up invisible. Older orders predate the attempts list,
        // so fall back to the order id, which is what their single gateway order was called.
        var attempts = order.PaymentAttempts.Count > 0
            ? order.PaymentAttempts.Select(a => a.CashfreeOrderId).ToList()
            : [orderId];

        var anyRecorded = false;

        // Tracked per gateway order, because the original payment and a pending edit's top-up have
        // entirely separate fates: a top-up going unpaid drops the edit, while the *original*
        // going unpaid stands the whole order down. Judging both off one combined flag is how an
        // abandoned top-up could look like an abandoned order, and vice versa.
        var amendmentOrderId = order.PendingAmendment?.CashfreeOrderId;
        var amendmentLive = false;
        var originalLive = false;
        string? originalFailureReason = null;

        // The customer has just come back from paying one specific thing: the most recent gateway
        // order raised against this one. Its fate is what the banner has to report - the order's
        // own status answers a different question, and answering that one instead is how a top-up
        // left pending at the bank got announced as "payment successful".
        var latestAttempt = order.PaymentAttempts.Count > 0
            ? order.PaymentAttempts[^1].CashfreeOrderId
            : orderId;
        var latestSucceeded = false;
        var latestPending = false;
        string? latestFailureReason = null;

        foreach (var cashfreeOrderId in attempts)
        {
            var isAmendment = cashfreeOrderId == amendmentOrderId;
            var isLatest = cashfreeOrderId == latestAttempt;

            foreach (var payment in await _cashfreeService.GetPaymentsAsync(cashfreeOrderId))
            {
                if (payment.IsSuccess)
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

                // "Live" means this gateway order may still yield money - it succeeded, or the
                // bank hasn't finished deciding. Anything else is over.
                var live = payment.IsSuccess || payment.IsInFlight;
                if (isAmendment)
                {
                    amendmentLive |= live;
                }
                else
                {
                    originalLive |= live;
                    originalFailureReason ??= payment.IsFailed ? payment.FailureReason : null;
                }

                if (isLatest)
                {
                    latestSucceeded |= payment.IsSuccess;
                    latestPending |= payment.IsInFlight;
                    latestFailureReason ??= payment.IsFailed ? payment.FailureReason : null;
                }
            }
        }

        // The customer is demonstrably back on our site. If the edit they went off to pay for has
        // no payment against it - not even one the bank is still deciding on - they left without
        // paying, so those changes are dropped now rather than hanging over the order. This is the
        // difference between an honest "nothing was charged, your order is unchanged" and the
        // customer being told to keep refreshing a page that will never resolve.
        var amendmentDiscarded = false;
        if (amendmentOrderId != null && !amendmentLive)
            amendmentDiscarded = await _paymentOutcome.DiscardAsync(orderId, amendmentOrderId);
        else if (amendmentOrderId != null)
            await _paymentOutcome.ApplyIfPaidAsync(orderId);

        var refreshed = await _orderService.RefreshPaymentStateAsync(orderId) ?? order;

        // The same reasoning applied to the order's *own* payment. An order the customer never
        // paid for shouldn't sit in their list saying "payment pending" forever, holding stock and
        // any wallet credit it spent - it has failed, and saying so is the only way they know to
        // try again. Guarded on the order not being settled so a wallet-covered order, which never
        // reaches the gateway at all and so has no payments to find, is never caught by this.
        var settled = string.Equals(refreshed.PaymentStatus, "Paid", StringComparison.Ordinal);
        if (!settled && !originalLive &&
            !string.Equals(refreshed.Status, "Cancelled", StringComparison.OrdinalIgnoreCase))
        {
            await _paymentOutcome.FailOrderAsync(orderId, originalFailureReason ?? NotAttemptedReason);
            var failed = await _orderService.GetOrderByIdAsync(orderId);
            return Ok(new CashfreePaymentStatusResponse(
                "Failed", null, amendmentDiscarded, failed?.PaymentFailureReason,
                failed?.ToResponse(), PaymentAttemptOutcomes.Failed));
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
        var outcome =
            latestSucceeded ? PaymentAttemptOutcomes.Paid
            : latestPending ? PaymentAttemptOutcomes.Pending
            : amendmentDiscarded ? PaymentAttemptOutcomes.Discarded
            : latestFailureReason != null ? PaymentAttemptOutcomes.Failed
            : PaymentAttemptOutcomes.Paid;

        return Ok(new CashfreePaymentStatusResponse(
            refreshed.PaymentStatus, refreshed.PaymentInstrument, amendmentDiscarded,
            refreshed.PaymentFailureReason ?? latestFailureReason, refreshed.ToResponse(), outcome));
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

        using var doc = JsonDocument.Parse(rawBody);
        var root = doc.RootElement;
        var type = root.GetProperty("type").GetString();
        var cashfreeOrderId = root.GetProperty("data").GetProperty("order").GetProperty("order_id").GetString();

        if (string.IsNullOrWhiteSpace(cashfreeOrderId))
            return Ok(); // Nothing to act on - acknowledge so Cashfree doesn't keep retrying.

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

                var payment = root.GetProperty("data").GetProperty("payment");
                var cfPaymentId = payment.GetProperty("cf_payment_id").ToString();
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
                await _paymentOutcome.FailOrderAsync(orderId, WebhookFailureReason(root, type));
                break;
            }
        }

        return Ok();
    }

    /// <summary>Digs the human-readable reason out of a failure webhook. Cashfree puts it in
    /// error_details.error_description, falling back to the payment's own message; a customer who
    /// simply walked away gets that said plainly, since the payload has nothing to explain.</summary>
    private static string WebhookFailureReason(JsonElement root, string? type)
    {
        if (string.Equals(type, "PAYMENT_USER_DROPPED_WEBHOOK", StringComparison.Ordinal))
            return "You left the payment page before the payment went through.";

        var data = root.GetProperty("data");

        if (data.TryGetProperty("error_details", out var details) &&
            details.ValueKind == JsonValueKind.Object &&
            details.TryGetProperty("error_description", out var description) &&
            !string.IsNullOrWhiteSpace(description.GetString()))
        {
            return description.GetString()!.Trim();
        }

        if (data.TryGetProperty("payment", out var payment) &&
            payment.TryGetProperty("payment_message", out var message) &&
            !string.IsNullOrWhiteSpace(message.GetString()))
        {
            return message.GetString()!.Trim();
        }

        return "The payment was declined.";
    }
}
