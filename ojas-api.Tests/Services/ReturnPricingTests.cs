using OjasApi.Models;
using OjasApi.Services;
using Shouldly;

namespace OjasApi.Tests.Services;

/// <summary>
/// What a returned pack is worth back.
///
/// These are the cases where the obvious answer - the price on the line - is the wrong one: a
/// basket coupon the line shared in, and a gateway offer that meant the customer never handed
/// over the order's face value at all. Both would otherwise refund more than was ever taken.
/// </summary>
public class ReturnPricingTests
{
    private static Order OrderWith(
        decimal price = 100m,
        int quantity = 3,
        decimal discountAmount = 0m,
        decimal deliveryCharge = 0m,
        decimal walletApplied = 0m,
        decimal gatewayPaid = 0m,
        decimal amountPaid = 0m)
    {
        var subtotal = price * quantity;
        var order = new Order
        {
            Id = "order-1",
            FullName = "Test",
            Phone = "9123456789",
            Address = "1 St",
            Items = [new OrderItem { ProductId = "p1", ProductName = "Bajra Flour", Price = price, Weight = "1kg", Quantity = quantity }],
            Subtotal = subtotal,
            DiscountAmount = discountAmount,
            DeliveryCharge = deliveryCharge,
            TotalAmount = subtotal - discountAmount + deliveryCharge,
            WalletAmountApplied = walletApplied,
            AmountPaid = amountPaid,
        };

        if (gatewayPaid > 0)
            order.Payments.Add(new OrderPayment { CfPaymentId = "cf1", Amount = gatewayPaid });

        return order;
    }

    [Fact]
    public void APlainOrder_RefundsTheLinePrice()
    {
        var order = OrderWith(price: 100m, quantity: 3, gatewayPaid: 300m, amountPaid: 300m);

        ReturnPricing.LineRefund(order, order.Items[0], 2).ShouldBe(200m);
    }

    /// <summary>The delivery charge is not refundable on a return - the delivery happened, and
    /// the policy page says so.</summary>
    [Fact]
    public void TheDeliveryCharge_IsNotPartOfALineRefund()
    {
        var order = OrderWith(price: 100m, quantity: 2, deliveryCharge: 40m, gatewayPaid: 240m, amountPaid: 240m);

        ReturnPricing.LineRefund(order, order.Items[0], 2).ShouldBe(200m);
    }

    /// <summary>A customer who got 10% off the basket does not get the undiscounted price back
    /// for one pack out of it.</summary>
    [Fact]
    public void ABasketDiscount_IsSharedByTheLineProRata()
    {
        // 3 x 100 = 300 subtotal, 10% off = 30 discount. One unit is worth 100 less its 10 share.
        var order = OrderWith(price: 100m, quantity: 3, discountAmount: 30m, gatewayPaid: 270m, amountPaid: 270m);

        ReturnPricing.LineRefund(order, order.Items[0], 1).ShouldBe(90m);
        ReturnPricing.LineRefund(order, order.Items[0], 3).ShouldBe(270m);
    }

    /// <summary>
    /// A gateway offer is money the customer was never charged and we never received, so it
    /// cannot come back. Refunding face value here would hand out real money against a discount
    /// somebody else gave.
    /// </summary>
    [Fact]
    public void AGatewayOffer_ShrinksTheRefundToWhatWasActuallyCharged()
    {
        // Order raised for 300; the bank's offer meant only 270 was ever charged.
        var order = OrderWith(price: 100m, quantity: 3, gatewayPaid: 270m, amountPaid: 270m);
        order.GatewayDiscounts.Add(new OrderGatewayDiscount { CashfreeOrderId = "cf-order", Amount = 30m });

        ReturnPricing.PaidRatio(order).ShouldBe(0.9m);
        ReturnPricing.LineRefund(order, order.Items[0], 1).ShouldBe(90m);
    }

    /// <summary>
    /// The ratio is measured against what was originally taken, not against what the order still
    /// holds. Deriving it from the live figure would shrink every successive return, so a customer
    /// sending two packs back in two requests would get less than one sending both at once.
    /// </summary>
    [Fact]
    public void AnAlreadyPartlyRefundedOrder_StillPricesTheNextReturnAtFullValue()
    {
        var order = OrderWith(price: 100m, quantity: 3, gatewayPaid: 300m, amountPaid: 300m);
        // A first return of one pack has already been settled.
        order.AmountRefunded = 100m;
        order.AmountPaid = 200m;

        ReturnPricing.LineRefund(order, order.Items[0], 1).ShouldBe(100m);
    }

    /// <summary>Wallet-funded orders are ordinary here: the money was still handed over, it just
    /// came from store credit.</summary>
    [Fact]
    public void AWalletFundedOrder_RefundsInFull()
    {
        var order = OrderWith(price: 100m, quantity: 2, walletApplied: 200m, amountPaid: 200m);

        ReturnPricing.LineRefund(order, order.Items[0], 2).ShouldBe(200m);
    }

    /// <summary>Whatever the lines say, an order can never hand back more than it is holding.</summary>
    [Fact]
    public void TheCap_IsWhatTheOrderStillHolds()
    {
        var order = OrderWith(price: 100m, quantity: 3, gatewayPaid: 300m, amountPaid: 50m);

        ReturnPricing.CapToRefundable(order, 300m).ShouldBe(50m);
        ReturnPricing.Refundable(order).ShouldBe(50m);
    }

    [Fact]
    public void AnOrderThatWasNeverPaid_RefundsNothing()
    {
        var order = OrderWith(price: 100m, quantity: 3);

        ReturnPricing.PaidRatio(order).ShouldBe(0m);
        ReturnPricing.LineRefund(order, order.Items[0], 1).ShouldBe(0m);
        ReturnPricing.Refundable(order).ShouldBe(0m);
    }

    /// <summary>The window runs to the end of its last day. A customer told "three days" does not
    /// expect it to expire at 4:07pm because that is when the doorbell rang.</summary>
    [Fact]
    public void TheWindowRunsToTheEndOfItsLastDay()
    {
        var delivered = new DateTime(2026, 9, 9, 16, 7, 0, DateTimeKind.Utc);

        ReturnPolicy.IsWithinWindow(delivered, delivered).ShouldBeTrue();
        ReturnPolicy.IsWithinWindow(delivered, new DateTime(2026, 9, 12, 23, 59, 0, DateTimeKind.Utc)).ShouldBeTrue();
        ReturnPolicy.IsWithinWindow(delivered, new DateTime(2026, 9, 13, 0, 1, 0, DateTimeKind.Utc)).ShouldBeFalse();
    }
}
