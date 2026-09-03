using System.Net;
using MongoDB.Driver;
using OjasApi.Models;

namespace OjasApi.Services;

/// <summary>
/// Tells a customer, by email, when their order reaches a stage they would care about.
///
/// Email rather than SMS is a deliberate substitute, not a preference. A branded order-update SMS
/// in India needs the sender's own DLT-registered entity, an approved header and a pre-registered
/// content template, with any link domain separately whitelisted - typically well over a week with
/// the telecom portals. (MSG91's OTP widget sidesteps that only because it rides MSG91's own
/// pre-registered OTP template; the exemption does not extend to a custom message.) When DLT
/// clears, SMS plugs into this same call site with no other change.
///
/// Two rules this must never break:
///   - It must never fail an order operation. Every send is wrapped; a bounced or misconfigured
///     mailer is not a reason a customer's cancellation fails.
///   - It must never be the thing that tells a customer something untrue. It reports the status it
///     is handed, after that status has been written, never before.
/// </summary>
public class OrderStatusEmailService
{
    private readonly IMongoDbService _db;
    private readonly IEmailSender _emailSender;
    private readonly IConfiguration _config;
    private readonly ILogger<OrderStatusEmailService> _logger;

    public OrderStatusEmailService(
        IMongoDbService db,
        IEmailSender emailSender,
        IConfiguration config,
        ILogger<OrderStatusEmailService> logger)
    {
        _db = db;
        _emailSender = emailSender;
        _config = config;
        _logger = logger;
    }

    /// <summary>
    /// Delivery only, by the owner's decision.
    ///
    /// Every other status is something the customer either already knows (they just paid, or they
    /// just pressed Cancel) or cannot act on (Packed is an internal milestone). Delivery is the one
    /// moment worth a durable written record they can find again later, and the one where a
    /// mistake needs to be raised with us quickly.
    ///
    /// It is also the frugal choice. Resend's free tier is 100 emails a day across the whole site,
    /// shared with registration and password resets; one per order rather than four means order
    /// volume can grow roughly fourfold before that ceiling is anywhere near.
    /// </summary>
    private static readonly HashSet<string> NotifiableStatuses =
    [
        "Delivered",
    ];

    public static bool ShouldNotify(string? status) =>
        status != null && NotifiableStatuses.Contains(status);

    /// <summary>Sends the update if this status warrants one. Swallows every failure by design -
    /// see the class summary. Safe to call for any status; it decides for itself.</summary>
    public async Task SendStatusUpdateAsync(Order order, string status)
    {
        if (!ShouldNotify(status))
            return;

        try
        {
            var email = await ResolveCustomerEmailAsync(order);
            if (string.IsNullOrWhiteSpace(email))
            {
                // A guest order, or an account whose user record has gone. Not an error worth
                // shouting about, but worth being able to find if someone asks why no mail arrived.
                _logger.LogInformation(
                    "No email on file for order {OrderId}; skipped the {Status} update.", order.Id, status);
                return;
            }

            var (subject, headline, body) = ComposeFor(order, status);
            var html = BuildHtml(order, headline, body);

            await _emailSender.SendAsync(email, subject, html);
            _logger.LogInformation("Sent the {Status} update for order {OrderId}.", status, order.Id);
        }
        catch (Exception ex)
        {
            _logger.LogWarning(
                ex, "Could not email the {Status} update for order {OrderId}; the order itself is unaffected.",
                status, order.Id);
        }
    }

    /// <summary>The order carries no email of its own - only the account that placed it does - so
    /// this reads it from the user. Deliberately not gated on IsEmailVerified: registration
    /// verifies the phone, not the address, so requiring verification here would mean almost no
    /// customer ever received an order update.</summary>
    private async Task<string?> ResolveCustomerEmailAsync(Order order)
    {
        if (string.IsNullOrWhiteSpace(order.UserId))
            return null;

        var user = await _db.Users.Find(u => u.Id == order.UserId).FirstOrDefaultAsync();
        return user?.Email;
    }

    private static (string Subject, string Headline, string Body) ComposeFor(Order order, string status)
    {
        var reference = ShortReference(order);

        return status switch
        {
            "Confirmed" => (
                $"Order {reference} confirmed",
                "Your order is confirmed",
                "Thank you - we've received your payment and started getting your order ready. "
                    + "Estimated delivery is 1-2 days."),

            "Shipped" => (
                $"Order {reference} is on its way",
                "Your order is out for delivery",
                "Your order has left us and is on its way to you. Please keep your phone handy - "
                    + "our delivery partner may call to find you."),

            "Delivered" => (
                $"Order {reference} delivered",
                "Your order has been delivered",
                "We hope you enjoy it. If anything wasn't right, reply to this email or call us and "
                    + "we'll put it right."),

            "Cancelled" => (
                $"Order {reference} cancelled",
                "Your order has been cancelled",
                "This order has been cancelled. Anything already paid is being returned to you - "
                    + "the order page below shows exactly what was refunded and where it went."),

            _ => (
                $"Update on order {reference}",
                "There's an update on your order",
                $"Your order is now {status.ToLowerInvariant()}."),
        };
    }

    /// <summary>What a customer sees on the order card, so the email and the site agree. A Mongo
    /// ObjectId is 24 characters and nobody reads one out over the phone.</summary>
    private static string ShortReference(Order order) =>
        string.IsNullOrWhiteSpace(order.Id) ? "" : $"#{order.Id[^6..].ToUpperInvariant()}";

    private string BuildHtml(Order order, string headline, string body)
    {
        // Frontend:BaseUrl is validated at startup in Production (absolute https), so this cannot
        // silently produce a relative link that no mail client can follow.
        var baseUrl = (_config["Frontend:BaseUrl"] ?? string.Empty).TrimEnd('/');
        var orderLink = $"{baseUrl}/my-orders?order={Uri.EscapeDataString(order.Id ?? string.Empty)}";

        // Deep-links to this one order rather than the list: My Orders reads ?order= and scrolls
        // that card into view and highlights it, so a customer with a dozen orders is not left
        // hunting for the one the email is about.
        var items = string.Join("", order.Items.Select(i => $"""
            <tr>
              <td style="padding:6px 0;color:#3a2f28;">{WebUtility.HtmlEncode(i.ProductName)}
                <span style="color:#6b5d54;">({WebUtility.HtmlEncode(i.Weight)}) &times; {i.Quantity}</span>
              </td>
              <td style="padding:6px 0;text-align:right;color:#3a2f28;white-space:nowrap;">
                &#8377;{(i.Price * i.Quantity):N2}
              </td>
            </tr>
            """));

        // Inline styles throughout, and a table for the items: email clients strip <style> blocks
        // and support almost no modern layout.
        return $"""
            <div style="font-family:'Helvetica Neue',Arial,sans-serif;color:#3a2f28;line-height:1.6;">
              <p style="font-size:18px;font-weight:600;margin:0 0 8px;">{WebUtility.HtmlEncode(headline)}</p>
              <p style="margin:0 0 4px;">Hi {WebUtility.HtmlEncode(order.FullName)},</p>
              <p style="margin:0 0 16px;">{WebUtility.HtmlEncode(body)}</p>

              <table style="width:100%;max-width:480px;border-collapse:collapse;margin:0 0 8px;">
                {items}
                <tr>
                  <td style="padding:10px 0 0;border-top:1px solid #ece5dd;font-weight:600;">Total paid</td>
                  <td style="padding:10px 0 0;border-top:1px solid #ece5dd;text-align:right;font-weight:600;">
                    &#8377;{order.TotalAmount:N2}
                  </td>
                </tr>
              </table>

              <p style="margin:20px 0;">
                <a href="{orderLink}"
                   style="background:#b3541e;color:#ffffff;text-decoration:none;padding:11px 20px;
                          border-radius:8px;display:inline-block;font-weight:600;">
                  View this order
                </a>
              </p>

              <p style="color:#6b5d54;font-size:13px;margin:0;">
                Delivering to {WebUtility.HtmlEncode(order.Address)}
              </p>
              <p style="color:#6b5d54;font-size:13px;margin:12px 0 0;">
                Questions? Reply to this email or call +91 8657781526.<br />
                Ojas is a brand of Asha Marketing, Pune.
              </p>
            </div>
            """;
    }
}
