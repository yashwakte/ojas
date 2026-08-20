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
}
