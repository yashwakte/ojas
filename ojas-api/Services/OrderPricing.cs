namespace OjasApi.Services;

/// <summary>A discount the customer must explicitly pick at checkout - never applied
/// automatically. <see cref="MinCartValue"/> is the eligibility gate.</summary>
public record Coupon(string Code, string Title, decimal DiscountPercentage, decimal MinCartValue);

/// <summary>Coupon catalog and the free-delivery rule. Distinct from the distance-based
/// free delivery in <see cref="DeliveryChargesService"/> — a cart can qualify for free
/// delivery here even from a distance that would otherwise be charged, and free delivery
/// itself is automatic (not a coupon a customer has to pick).</summary>
public static class OrderPricing
{
    public static readonly IReadOnlyList<Coupon> Coupons =
    [
        new Coupon("SAVE5", "Flat 5% Off", 5m, 1000m),
        new Coupon("SAVE10", "Flat 10% Off", 10m, 2000m),
    ];

    public const decimal FreeDeliveryCartThreshold = 500m;

    /// <summary>
    /// The smallest amount the payment gateway will accept. Cashfree refuses anything below this
    /// with <c>order_amount_invalid</c>, verified against its sandbox: ₹0.99 is rejected and ₹1.00
    /// is accepted.
    ///
    /// It lives here because three separate flows can compute a sub-rupee amount and try to charge
    /// it — a wallet balance that leaves a few paise outstanding, an edit whose coupon change makes
    /// the top-up tiny, and an order left a few paise short by a gateway offer. Each one produced
    /// an order that could never be paid: created, holding stock, and answering the customer with
    /// a failure they could do nothing about.
    /// </summary>
    public const decimal MinimumGatewayAmount = 1m;

    /// <summary>Whether an outstanding balance is worth sending to the gateway at all. Anything
    /// under the minimum cannot be charged, and refusing to move on from it strands the customer
    /// on an order they are unable to complete — so it settles rather than blocking. The most this
    /// can ever forgive is 99 paise.</summary>
    public static bool IsChargeable(decimal amount) => amount >= MinimumGatewayAmount;

    /// <summary>Validates the coupon server-side against the current subtotal - an unknown
    /// code or one whose minimum cart value is no longer met is silently ignored rather than
    /// rejected, since the frontend only ever sends a code from its own button list (never
    /// free-typed), so a mismatch here only happens if the cart changed after the pick.</summary>
    public static (decimal Percentage, decimal Amount, string? Code) ApplyCoupon(string? couponCode, decimal subtotal)
    {
        if (string.IsNullOrWhiteSpace(couponCode))
            return (0m, 0m, null);

        var coupon = Coupons.FirstOrDefault(c => c.Code.Equals(couponCode, StringComparison.OrdinalIgnoreCase));
        if (coupon is null || subtotal < coupon.MinCartValue)
            return (0m, 0m, null);

        var amount = Math.Round(subtotal * coupon.DiscountPercentage / 100m, 2, MidpointRounding.AwayFromZero);
        return (coupon.DiscountPercentage, amount, coupon.Code);
    }

    public static bool QualifiesForFreeDelivery(decimal subtotal) => subtotal >= FreeDeliveryCartThreshold;
}
