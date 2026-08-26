using OjasApi.Models;
using Shouldly;

namespace OjasApi.Tests.Services;

/// <summary>
/// What an order is *settled* for, as opposed to how much money reached us.
///
/// These differ exactly when the gateway applies an offer: the customer is charged less than the
/// order was raised for, Cashfree still reports the gateway order PAID, and the customer owes
/// nothing further. Deriving "is this paid" by summing what the customer was charged left those
/// orders stuck at PartiallyPaid, telling the customer to pay a difference that had already been
/// discounted away.
/// </summary>
public class GatewayDiscountTests
{
    private static Order OrderWith(decimal total, decimal captured, decimal discount, decimal wallet = 0m)
    {
        var order = new Order
        {
            UserId = "u1",
            FullName = "Test",
            Phone = "9000000000",
            Address = "Somewhere",
            TotalAmount = total,
            WalletAmountApplied = wallet,
        };

        if (captured > 0)
            order.Payments.Add(new OrderPayment { CfPaymentId = "pay_1", CashfreeOrderId = "cf_1", Amount = captured });

        if (discount > 0)
            order.GatewayDiscounts.Add(new OrderGatewayDiscount { CashfreeOrderId = "cf_1", Amount = discount });

        order.RecomputeAmountPaid();
        return order;
    }

    [Fact]
    public void AnOrderPaidWithAGatewayOffer_IsSettledInFull()
    {
        // 530 order, 50 knocked off on the payment page, 480 actually charged.
        var order = OrderWith(total: 530m, captured: 480m, discount: 50m);

        order.AmountPaid.ShouldBe(480m);      // what reached us
        order.GatewayDiscountTotal.ShouldBe(50m);
        order.SettledAmount.ShouldBe(530m);   // what the customer owes nothing beyond
        order.SettledAmount.ShouldBeGreaterThanOrEqualTo(order.TotalAmount);
    }

    [Fact]
    public void WithoutTheDiscount_TheSameOrderLooksUnderpaid()
    {
        // The old behaviour, kept as a test so the regression is unmistakable if it returns.
        var order = OrderWith(total: 530m, captured: 480m, discount: 0m);

        order.SettledAmount.ShouldBe(480m);
        order.SettledAmount.ShouldBeLessThan(order.TotalAmount);
    }

    [Fact]
    public void AGenuinelyPartPaidOrder_IsStillPartPaid()
    {
        // A discount must not paper over a real shortfall: 530 owed, 300 charged, 50 discounted
        // still leaves 180 outstanding.
        var order = OrderWith(total: 530m, captured: 300m, discount: 50m);

        order.SettledAmount.ShouldBe(350m);
        order.SettledAmount.ShouldBeLessThan(order.TotalAmount);
    }

    [Fact]
    public void WalletCreditAndAGatewayOffer_AddUpTogether()
    {
        var order = OrderWith(total: 530m, captured: 380m, discount: 50m, wallet: 100m);

        order.AmountPaid.ShouldBe(480m);    // wallet 100 + captured 380
        order.SettledAmount.ShouldBe(530m); // plus the 50 offer
    }

    [Fact]
    public void ARefund_ComesOffTheSettledFigureToo()
    {
        var order = OrderWith(total: 530m, captured: 480m, discount: 50m);
        order.AmountRefunded = 130m;
        order.RecomputeAmountPaid();

        order.AmountPaid.ShouldBe(350m);
        order.SettledAmount.ShouldBe(400m);
    }

    [Fact]
    public void TheDiscountTotalIgnoresNothingAndDoubleCountsNothing()
    {
        var order = OrderWith(total: 900m, captured: 700m, discount: 50m);
        // A second attempt (a top-up) carrying its own offer.
        order.GatewayDiscounts.Add(new OrderGatewayDiscount { CashfreeOrderId = "cf_2", Amount = 25m });

        order.GatewayDiscountTotal.ShouldBe(75m);
    }
}
