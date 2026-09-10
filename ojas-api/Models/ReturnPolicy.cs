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

    /// <summary>India is UTC+5:30 all year - no daylight saving - so a fixed offset is exact.</summary>
    private static readonly TimeSpan IndiaOffset = TimeSpan.FromHours(5.5);

    /// <summary>When the window shuts for an order delivered at <paramref name="deliveredAt"/>
    /// (UTC): the last moment of the third day after the delivery day, on India's clock. Delivered
    /// any time on the 11th means returnable until 11:59pm on the 14th, so on delivery day the
    /// customer has three whole days ahead, which is what "3 days" promised - and it does not
    /// expire at 4:07pm because that is when the doorbell rang.
    ///
    /// <para>It used to take the date in UTC, five and a half hours behind the wall clock here: a
    /// window "ending at midnight" really shut at 5:29am, and an order delivered between midnight
    /// and 5:30am was counted as delivered the day before, costing the customer most of a day.</para>
    /// </summary>
    public static DateTime WindowEndsAt(DateTime deliveredAt)
    {
        var utc = deliveredAt.Kind == DateTimeKind.Local ? deliveredAt.ToUniversalTime() : deliveredAt;
        var deliveryDayInIndia = (utc + IndiaOffset).Date;
        var closesInIndia = deliveryDayInIndia.AddDays(WindowDays + 1);
        return DateTime.SpecifyKind(closesInIndia - IndiaOffset, DateTimeKind.Utc).AddTicks(-1);
    }

    public static bool IsWithinWindow(DateTime deliveredAt, DateTime now) =>
        now <= WindowEndsAt(deliveredAt);
}
