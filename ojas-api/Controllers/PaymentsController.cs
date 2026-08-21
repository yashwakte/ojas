using System.Text;
using System.Text.Json;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.RateLimiting;
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
    private readonly ProductService _productService;
    private readonly ILogger<PaymentsController> _logger;

    public PaymentsController(
        CashfreeService cashfreeService,
        OrderService orderService,
        ProductService productService,
        ILogger<PaymentsController> logger)
    {
        _cashfreeService = cashfreeService;
        _orderService = orderService;
        _productService = productService;
        _logger = logger;
    }

    /// <summary>The only thing that ever marks an order Paid - never the customer's browser
    /// redirect back from checkout, which proves nothing about whether the bank approved the
    /// charge. Reads the raw request body directly (rather than relying on model binding) since
    /// the signature must be verified against the exact bytes Cashfree sent, not a
    /// re-serialized copy.</summary>
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
        var orderId = root.GetProperty("data").GetProperty("order").GetProperty("order_id").GetString();

        if (string.IsNullOrWhiteSpace(orderId))
            return Ok(); // Nothing to act on - acknowledge so Cashfree doesn't keep retrying.

        switch (type)
        {
            case "PAYMENT_SUCCESS_WEBHOOK":
            {
                var cfPaymentId = root.GetProperty("data").GetProperty("payment").GetProperty("cf_payment_id").GetString() ?? "";
                await _orderService.MarkPaymentPaidAsync(orderId, cfPaymentId);
                _logger.LogInformation("Cashfree payment confirmed for order {OrderId} ({CfPaymentId}).", orderId, cfPaymentId);
                break;
            }
            case "PAYMENT_FAILED_WEBHOOK":
            case "PAYMENT_USER_DROPPED_WEBHOOK":
            {
                var order = await _orderService.GetOrderByIdAsync(orderId);
                // Guarded the same way admin cancellation is - re-delivering an already-handled
                // webhook (Cashfree retries on a non-2xx response) must not restore stock twice.
                if (order != null && !string.Equals(order.Status, "Cancelled", StringComparison.OrdinalIgnoreCase))
                {
                    await _orderService.MarkPaymentFailedAsync(orderId);
                    await _orderService.UpdateOrderStatusAsync(orderId, "Cancelled");
                    await _productService.RestoreStockAsync(order.Items.Select(i => (i.ProductId, i.Quantity)));
                    _logger.LogInformation("Cashfree payment failed/dropped for order {OrderId} - order cancelled, stock restored.", orderId);
                }
                break;
            }
        }

        return Ok();
    }
}
