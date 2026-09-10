namespace OjasApi.Models;

/// <summary>
/// The returns policy as numbers, in one place.
///
/// The owner set this on 9 September 2026: three days from delivery, unopened packs in their
/// original packaging, collected free. It is stated to customers on the Refunds and Cancellations
/// page, in the Terms, on the cart, on the product page, on a delivered order and by the chatbot -
/// and enforced here. A window the API enforces at a different number from the one the site
/// promises is the worst of both, so every server-side check reads this constant, and the
/// frontend's own copy lives in `constants/business.ts` under the same name.
/// </summary>
public static class ReturnPolicy
{
    /// <summary>Days from delivery - not from when the order was placed. With a 1-2 day delivery
    /// promise, running it from the order date would leave some customers barely a day.</summary>
    public const int WindowDays = 3;

    /// <summary>When the window shuts for an order delivered at <paramref name="deliveredAt"/>.
    /// End of that day rather than the exact hour: a customer told "3 days" does not expect it to
    /// expire at 4:07pm because that is when the doorbell rang.</summary>
    public static DateTime WindowEndsAt(DateTime deliveredAt) =>
        deliveredAt.Date.AddDays(WindowDays + 1).AddTicks(-1);

    public static bool IsWithinWindow(DateTime deliveredAt, DateTime now) =>
        now <= WindowEndsAt(deliveredAt);
}
