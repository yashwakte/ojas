using OjasApi.Models;

namespace OjasApi.Services;

/// <summary>
/// What a returned line is worth back.
///
/// Kept as pure functions with no database in sight, because this is money arithmetic against an
/// order that may have been discounted twice over, and it has to be readable and testable on its
/// own. Every figure here is rounded to paise the way the rest of the money code rounds, so a
/// refund can never differ from what the customer was shown by a rounding mode.
/// </summary>
public static class ReturnPricing
{
    private static decimal Money(decimal value) => Math.Round(value, 2, MidpointRounding.AwayFromZero);

    /// <summary>
    /// What the customer actually parted with for this order, as a fraction of its face value.
    ///
    /// This is 1 for an ordinary order and less than 1 when the payment gateway applied an offer
    /// of its own: the customer was charged less than the order was raised for, and that shortfall
    /// was never our money to give back. Refunding a line at face value in that case would hand
    /// back more than was ever taken, which is the exact failure the policy page already promises
    /// against - "only what was actually charged is refunded".
    /// </summary>
    public static decimal PaidRatio(Order order)
    {
        if (order.TotalAmount <= 0) return 0m;

        // Deliberately measured from what was originally taken, not from AmountPaid, which drops
        // every time part of this order is refunded. Using the live figure would shrink each
        // successive return's ratio and quietly short-change a customer returning two packs in
        // two requests rather than one.
        var originallyPaid = order.WalletAmountApplied + order.Payments.Sum(p => p.Amount);
        if (originallyPaid <= 0) return 0m;

        var ratio = originallyPaid / order.TotalAmount;
        return ratio > 1m ? 1m : ratio;
    }

    /// <summary>
    /// What <paramref name="quantity"/> units of <paramref name="item"/> are worth back.
    ///
    /// The line gives up its share of any order-level discount, pro-rated by what it contributed
    /// to the subtotal - a customer who got 10% off the basket does not get the undiscounted price
    /// back for one pack out of it. The delivery charge is not in here at all: the delivery
    /// happened, and the policy says so.
    /// </summary>
    public static decimal LineRefund(Order order, OrderItem item, int quantity)
    {
        if (quantity <= 0) return 0m;

        var gross = Money(item.Price * quantity);

        var discountShare = 0m;
        if (order.DiscountAmount > 0 && order.Subtotal > 0)
            discountShare = Money(order.DiscountAmount * (gross / order.Subtotal));

        var net = gross - discountShare;
        if (net <= 0) return 0m;

        return Money(net * PaidRatio(order));
    }

    /// <summary>
    /// The most this order can still hand back, whatever the lines add up to.
    ///
    /// An order that has already been partly refunded - an earlier return, an edit that lowered
    /// the total - holds less than it once did, and a return must never be able to take out more
    /// than is in there. Capping here rather than trusting the line arithmetic is what makes two
    /// returns raised at the same moment safe to settle in either order.
    /// </summary>
    public static decimal Refundable(Order order) => Math.Max(0m, Money(order.AmountPaid));

    /// <summary>Applies that cap to a proposed refund.</summary>
    public static decimal CapToRefundable(Order order, decimal proposed) =>
        Math.Min(Money(proposed), Refundable(order));
}
