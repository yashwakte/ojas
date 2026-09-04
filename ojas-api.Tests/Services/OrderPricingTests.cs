using OjasApi.Services;
using Shouldly;

namespace OjasApi.Tests.Services;

public class OrderPricingTests
{
    [Theory]
    [InlineData("SAVE5", 999.99, 0, 0, null)]
    [InlineData("SAVE5", 1000, 5, 50, "SAVE5")]
    [InlineData("SAVE5", 1500, 5, 75, "SAVE5")]
    [InlineData("save5", 1500, 5, 75, "SAVE5")] // case-insensitive, since it's a fixed button-driven pick, not free text
    [InlineData("SAVE10", 1999.99, 0, 0, null)] // below SAVE10's own minimum - never falls back to SAVE5
    [InlineData("SAVE10", 2000, 10, 200, "SAVE10")]
    [InlineData("SAVE10", 5000, 10, 500, "SAVE10")]
    [InlineData("NOT-A-CODE", 5000, 0, 0, null)]
    [InlineData(null, 5000, 0, 0, null)]
    public void ApplyCoupon_ValidatesCodeAndMinimumServerSide(string? code, decimal subtotal, decimal expectedPercentage, decimal expectedAmount, string? expectedCode)
    {
        var (percentage, amount, appliedCode) = OrderPricing.ApplyCoupon(code, subtotal);

        percentage.ShouldBe(expectedPercentage);
        amount.ShouldBe(expectedAmount);
        appliedCode.ShouldBe(expectedCode);
    }

    [Theory]
    [InlineData(499.99, false)]
    [InlineData(500, true)]
    [InlineData(1000, true)]
    public void QualifiesForFreeDelivery_ThresholdIsInclusive(decimal subtotal, bool expected)
    {
        OrderPricing.QualifiesForFreeDelivery(subtotal).ShouldBe(expected);
    }

    /// <summary>Verified against Cashfree's sandbox: ₹0.99 comes back
    /// <c>order_amount_invalid</c> and ₹1.00 is accepted.</summary>
    [Theory]
    [InlineData(0.01, false)]
    [InlineData(0.99, false)]
    [InlineData(1, true)]
    [InlineData(200.50, true)]
    public void IsChargeable_MatchesWhatTheGatewayWillActuallyAccept(decimal amount, bool expected)
    {
        OrderPricing.IsChargeable(amount).ShouldBe(expected);
    }

    /// <summary>
    /// The wallet must never leave a remainder the gateway refuses.
    ///
    /// This is a real failure, not a theoretical one: an order for ₹200.50 against a ₹200 balance
    /// left ₹0.50 to charge, Cashfree rejected it as <c>order_amount_invalid</c>, and the customer
    /// got a created order holding stock that they could never pay for. A balance lands on an odd
    /// figure exactly when a refund has put it there — which is what cancelling and re-ordering
    /// does, so the window is narrower than it is rare.
    ///
    /// It is always resolved by spending *less* credit, so nobody is charged more than the order.
    /// </summary>
    [Theory]
    // Nothing to adjust: the balance covers the whole thing.
    [InlineData(500, 200.50, 200.50, 0)]
    // Would have left 50 paise for the gateway; holds back enough to leave a payable rupee.
    [InlineData(200, 200.50, 199.50, 1)]
    // Would have left a single paisa.
    [InlineData(200.49, 200.50, 199.50, 1)]
    // Comfortably above the minimum already.
    [InlineData(100, 200.50, 100, 100.50)]
    // No balance at all.
    [InlineData(0, 200.50, 0, 200.50)]
    public void ApplicableAmount_NeverLeavesAnUnchargeableRemainder(
        decimal balance, decimal orderTotal, decimal expectedApplied, decimal expectedDue)
    {
        var applied = WalletService.ApplicableAmount(balance, orderTotal);

        applied.ShouldBe(expectedApplied);
        (orderTotal - applied).ShouldBe(expectedDue);

        // The property that actually matters, stated directly: whatever is left is either nothing
        // or something Cashfree will take.
        var due = orderTotal - applied;
        (due == 0 || OrderPricing.IsChargeable(due)).ShouldBeTrue($"₹{due} cannot be charged.");

        // And never more credit than the order is worth.
        applied.ShouldBeLessThanOrEqualTo(orderTotal);
        applied.ShouldBeLessThanOrEqualTo(balance);
    }
}
