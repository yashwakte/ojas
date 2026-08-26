using MongoDB.Bson;
using MongoDB.Bson.Serialization.Attributes;

namespace OjasApi.Models;

public class OrderItem
{
    [BsonElement("productId")]
    public required string ProductId { get; set; }

    [BsonElement("productName")]
    public required string ProductName { get; set; }

    [BsonElement("price")]
    public decimal Price { get; set; }

    [BsonElement("weight")]
    public required string Weight { get; set; }

    [BsonElement("quantity")]
    public int Quantity { get; set; }
}

/// <summary>A gateway order we asked the customer to pay. An order has more than one of these
/// once an edit raises the total: a Cashfree order's amount can't be amended, so the difference
/// is charged as its own gateway order with a suffixed id. Every one of these has to be checked
/// when working out what an order has actually been paid.</summary>
public class PaymentAttempt
{
    [BsonElement("cashfreeOrderId")]
    public required string CashfreeOrderId { get; set; }

    [BsonElement("amount")]
    public decimal Amount { get; set; }

    [BsonElement("createdAt")]
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
}

/// <summary>One captured payment, keyed by Cashfree's own payment id. That id is the idempotency
/// key: a webhook retry or a repeated status check re-reports the same payment, and recording by
/// id means it lands once. The order's paid total is the sum of these, never a counter that
/// callbacks increment.</summary>
public class OrderPayment
{
    [BsonElement("cfPaymentId")]
    public required string CfPaymentId { get; set; }

    [BsonElement("cashfreeOrderId")]
    public string? CashfreeOrderId { get; set; }

    [BsonElement("amount")]
    public decimal Amount { get; set; }

    /// <summary>Cashfree's payment_group - "upi", "credit_card", "net_banking" and so on.</summary>
    [BsonElement("instrument")]
    public string? Instrument { get; set; }

    [BsonElement("capturedAt")]
    public DateTime CapturedAt { get; set; } = DateTime.UtcNow;
}

/// <summary>A discount the payment gateway applied to one gateway order — a bank offer, a
/// promo code entered on Cashfree's own page, and so on. Keyed by the gateway order id for the
/// same reason payments are keyed by payment id: reconciliation runs repeatedly and must be able
/// to re-report the same offer without it accumulating.</summary>
public class OrderGatewayDiscount
{
    [BsonElement("cashfreeOrderId")]
    public required string CashfreeOrderId { get; set; }

    [BsonElement("amount")]
    public decimal Amount { get; set; }

    [BsonElement("recordedAt")]
    public DateTime RecordedAt { get; set; } = DateTime.UtcNow;
}

/// <summary>
/// A customer's edit that has been priced and sent to the gateway but <em>not paid for yet</em>.
/// It is deliberately held apart from the order's own fields: applying an edit before its top-up
/// is paid leaves an order showing goods the customer never paid for, and no way back if they
/// abandon the payment page. The order keeps showing what was actually bought and paid for until
/// the money lands, at which point this is copied over it (see OrderPaymentOutcomeService).
///
/// Stock for the extra items is reserved while this is live — otherwise the customer could pay
/// for something that sold out while they were on the payment page — and released again if the
/// amendment is discarded or expires.
/// </summary>
public class OrderAmendment
{
    [BsonElement("items")]
    public List<OrderItem> Items { get; set; } = [];

    [BsonElement("fullName")]
    public required string FullName { get; set; }

    [BsonElement("phone")]
    public required string Phone { get; set; }

    [BsonElement("address")]
    public required string Address { get; set; }

    [BsonElement("latitude")]
    public double Latitude { get; set; }

    [BsonElement("longitude")]
    public double Longitude { get; set; }

    [BsonElement("addressMapLink")]
    public string? AddressMapLink { get; set; }

    [BsonElement("notes")]
    public string Notes { get; set; } = string.Empty;

    [BsonElement("subtotal")]
    public decimal Subtotal { get; set; }

    [BsonElement("couponCode")]
    public string? CouponCode { get; set; }

    [BsonElement("discountPercentage")]
    public decimal DiscountPercentage { get; set; }

    [BsonElement("discountAmount")]
    public decimal DiscountAmount { get; set; }

    [BsonElement("deliveryCharge")]
    public decimal DeliveryCharge { get; set; }

    [BsonElement("deliveryDistanceKm")]
    public double DeliveryDistanceKm { get; set; }

    [BsonElement("totalAmount")]
    public decimal TotalAmount { get; set; }

    /// <summary>What the customer must pay for these changes to take effect — the difference
    /// between the amended total and what the order already holds.</summary>
    [BsonElement("topUpAmount")]
    public decimal TopUpAmount { get; set; }

    /// <summary>The gateway order raised for <see cref="TopUpAmount"/>. Also the key that makes
    /// applying and discarding safe against a webhook and a status check racing each other.</summary>
    [BsonElement("cashfreeOrderId")]
    public required string CashfreeOrderId { get; set; }

    [BsonElement("paymentSessionId")]
    public string? PaymentSessionId { get; set; }

    [BsonElement("createdAt")]
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;

    /// <summary>Past this, the changes are dropped and the reserved stock released, so an
    /// abandoned edit can't hold goods off the shelf indefinitely.</summary>
    [BsonElement("expiresAt")]
    public DateTime ExpiresAt { get; set; }

    public bool HasExpired => DateTime.UtcNow >= ExpiresAt;
}

public class Order
{
    [BsonId]
    [BsonRepresentation(BsonType.ObjectId)]
    public string? Id { get; set; }

    [BsonElement("userId")]
    public string? UserId { get; set; }

    [BsonElement("fullName")]
    public required string FullName { get; set; }

    [BsonElement("phone")]
    public required string Phone { get; set; }

    [BsonElement("address")]
    public required string Address { get; set; }

    [BsonElement("latitude")]
    public double Latitude { get; set; }

    [BsonElement("longitude")]
    public double Longitude { get; set; }

    [BsonElement("addressMapLink")]
    public string? AddressMapLink { get; set; }

    [BsonElement("notes")]
    public string Notes { get; set; } = string.Empty;

    [BsonElement("items")]
    public List<OrderItem> Items { get; set; } = [];

    [BsonElement("subtotal")]
    public decimal Subtotal { get; set; }

    /// <summary>Null when no coupon was applied (or the one requested didn't validate).</summary>
    [BsonElement("couponCode")]
    public string? CouponCode { get; set; }

    [BsonElement("discountPercentage")]
    public decimal DiscountPercentage { get; set; }

    [BsonElement("discountAmount")]
    public decimal DiscountAmount { get; set; }

    [BsonElement("deliveryCharge")]
    public decimal DeliveryCharge { get; set; }

    [BsonElement("deliveryDistanceKm")]
    public double DeliveryDistanceKm { get; set; }

    [BsonElement("totalAmount")]
    public decimal TotalAmount { get; set; }

    [BsonElement("status")]
    public string Status { get; set; } = "Pending";

    /// <summary>"Cashfree" for every new order - COD was retired. Older orders still carry
    /// "COD" and must keep rendering, which is why this stays a free-form field.</summary>
    [BsonElement("paymentMethod")]
    public string PaymentMethod { get; set; } = "Cashfree";

    [BsonElement("paymentStatus")]
    public string PaymentStatus { get; set; } = "Pending";

    /// <summary>How the customer actually paid, from Cashfree's payment_group - "upi",
    /// "credit_card", "net_banking", "wallet" and so on. Null until a payment succeeds.</summary>
    [BsonElement("paymentInstrument")]
    public string? PaymentInstrument { get; set; }

    /// <summary>Set on a failed order when the customer retried it, naming the order placed in
    /// its stead. The customer's own list hides it from then on: they care about the live attempt,
    /// not a trail of dead ones. Admins still see everything, since support does need the trail.
    /// </summary>
    [BsonElement("replacedByOrderId")]
    public string? ReplacedByOrderId { get; set; }

    /// <summary>Why the payment failed, in the gateway's own words where it gave any. Shown to the
    /// customer verbatim: "your payment was declined by your bank" is a lie when they simply
    /// closed the page, and a customer who can't tell which happened can't tell what to do next.
    /// Null unless <see cref="PaymentStatus"/> is "Failed".</summary>
    [BsonElement("paymentFailureReason")]
    public string? PaymentFailureReason { get; set; }

    /// <summary>Gateway orders we've asked the customer to pay — the original, plus one per
    /// top-up. Checking payment status means checking all of these.</summary>
    [BsonElement("paymentAttempts")]
    public List<PaymentAttempt> PaymentAttempts { get; set; } = [];

    /// <summary>Every captured gateway payment, keyed by Cashfree's payment id so a retried
    /// webhook or a repeated status check can't record the same money twice.</summary>
    [BsonElement("payments")]
    public List<OrderPayment> Payments { get; set; } = [];

    /// <summary>Discounts the gateway itself applied, keyed by the gateway order they belong to
    /// so a repeated status check cannot count the same offer twice.
    ///
    /// A Cashfree offer is settled between the customer, the bank and Cashfree - the customer is
    /// charged less than we asked for, and Cashfree still reports the gateway order as PAID.
    /// Summing what the customer was charged therefore understates what the order is settled for,
    /// which is why an order paid with an offer used to stick at "PartiallyPaid" forever, quietly
    /// telling the customer they still owed the difference.</summary>
    [BsonElement("gatewayDiscounts")]
    public List<OrderGatewayDiscount> GatewayDiscounts { get; set; } = [];

    /// <summary>Total discount the gateway applied across every attempt on this order.</summary>
    public decimal GatewayDiscountTotal =>
        Math.Round(GatewayDiscounts.Sum(d => d.Amount), 2, MidpointRounding.AwayFromZero);

    /// <summary>
    /// What the order is settled for: money we received, plus anything the gateway discounted on
    /// our behalf. This - not <see cref="AmountPaid"/> - is what decides whether the customer
    /// still owes anything, because a customer who used a gateway offer owes nothing further even
    /// though less money changed hands.
    /// </summary>
    public decimal SettledAmount =>
        Math.Round(AmountPaid + GatewayDiscountTotal, 2, MidpointRounding.AwayFromZero);

    /// <summary>Total handed back so far — wallet credits and refunds to the original payment
    /// method alike. Kept separate from the captured figure so neither has to be overwritten.</summary>
    [BsonElement("amountRefunded")]
    public decimal AmountRefunded { get; set; }

    /// <summary>What this order currently holds: wallet credit spent, plus every captured
    /// gateway payment, minus everything handed back. Derived from the records above rather than
    /// incremented by callbacks — see <see cref="RecomputeAmountPaid"/>. Persisted so queries and
    /// the API don't have to re-derive it.</summary>
    [BsonElement("amountPaid")]
    public decimal AmountPaid { get; set; }

    /// <summary>The single place the paid figure is worked out, so it can't drift.</summary>
    public decimal RecomputeAmountPaid() =>
        AmountPaid = Math.Round(
            WalletAmountApplied + Payments.Sum(p => p.Amount) - AmountRefunded,
            2,
            MidpointRounding.AwayFromZero);

    /// <summary>How much of this order was paid from wallet balance. On cancellation this
    /// portion always returns to the wallet, whatever the customer chooses for the rest.</summary>
    [BsonElement("walletAmountApplied")]
    public decimal WalletAmountApplied { get; set; }

    /// <summary>Set when a cancelling customer asked for their money back on the original
    /// payment method rather than as wallet credit. An admin confirms it from the dashboard —
    /// a customer action must never move real money on its own. Wallet refunds don't appear
    /// here at all: nothing leaves the business, so they're credited immediately.</summary>
    [BsonElement("refundPendingAmount")]
    public decimal? RefundPendingAmount { get; set; }

    /// <summary>An edit the customer has made but not yet paid the difference for. Null whenever
    /// the order is settled — the order's own fields are always what has actually been paid for,
    /// never a proposal.</summary>
    [BsonElement("pendingAmendment")]
    public OrderAmendment? PendingAmendment { get; set; }

    /// <summary>Cashfree's payment_session_id for this order - the frontend's checkout SDK
    /// needs it to open the hosted payment page. Null for COD orders.</summary>
    [BsonElement("paymentSessionId")]
    public string? PaymentSessionId { get; set; }

    /// <summary>Cashfree's own payment identifier, recorded once a PAYMENT_SUCCESS_WEBHOOK
    /// confirms the charge - kept for reconciliation and as the audit trail behind a refund.</summary>
    [BsonElement("cfPaymentId")]
    public string? CfPaymentId { get; set; }

    [BsonElement("deliveryPartnerId")]
    public string? DeliveryPartnerId { get; set; }

    [BsonElement("deliveryPartnerName")]
    public string? DeliveryPartnerName { get; set; }

    [BsonElement("createdAt")]
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;

    [BsonElement("updatedAt")]
    public DateTime? UpdatedAt { get; set; }
}
