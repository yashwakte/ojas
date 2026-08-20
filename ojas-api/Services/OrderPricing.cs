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
