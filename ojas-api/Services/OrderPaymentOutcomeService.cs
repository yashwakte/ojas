using OjasApi.Models;

namespace OjasApi.Services;

/// <summary>
/// What happens to an order once the payment gateway's verdict is in: a pending edit becomes real
/// or is thrown away, an unpaid order is stood down, and money that shouldn't be held is returned.
///
/// The rule this exists to enforce: <em>an order never shows goods the customer hasn't paid for,
/// and never quietly keeps money that bought nothing</em>. Applying an edit at save time and only
/// then asking for the difference meant a customer who backed out of the payment page was left
/// looking at the raised order, still being asked for money, with the extra stock already taken —
/// and nothing anywhere to undo it.
///
/// Both routes the gateway's verdict can reach us by — a verified webhook and the browser's
/// status check — come through these same methods, so neither can leave the order in a state the
/// other doesn't understand, and either arriving twice is harmless.
/// </summary>
public class OrderPaymentOutcomeService(
    OrderService orderService,
    ProductService productService,
    WalletService walletService,
    ILogger<OrderPaymentOutcomeService> logger)
{
    /// <summary>
    /// Applies the pending amendment if — and only if — the gateway order raised for it has
    /// actually been paid. Judged on payments recorded against the amendment's own gateway order
    /// id rather than on the order's paid total, so unrelated money moving (a refund, a second
    /// edit) can never be mistaken for the top-up landing.
    /// </summary>
    public async Task<bool> ApplyIfPaidAsync(string orderId)
    {
        var order = await orderService.GetOrderByIdAsync(orderId);
        if (order?.PendingAmendment is not { } amendment)
            return false;

        var paidForAmendment = order.Payments
            .Where(p => string.Equals(p.CashfreeOrderId, amendment.CashfreeOrderId, StringComparison.Ordinal))
            .Sum(p => p.Amount);

        if (paidForAmendment < amendment.TopUpAmount)
            return false;

        // Taken atomically: if a webhook and a status check both get this far, only one applies.
        var taken = await orderService.TryTakeAmendmentAsync(orderId, amendment.CashfreeOrderId);
        if (taken == null)
            return false;

        // Stock for the *extra* items was reserved when the amendment was staged; anything the
        // edit dropped is only released now that the edit is real.
        var delta = OrderService.StockDelta(order.Items, taken.Items);
        await productService.RestoreStockAsync(
            delta.Where(d => d.Quantity < 0).Select(d => (d.ProductId, -d.Quantity)));

        await orderService.ApplyAmendmentAsync(orderId, taken);

        logger.LogInformation(
            "Applied the paid amendment on order {OrderId}: total now {Total} after a {TopUp} top-up.",
            orderId, taken.TotalAmount, taken.TopUpAmount);

        return true;
    }

    /// <summary>
    /// Throws away an unpaid amendment and puts the stock it was holding back on the shelf. The
    /// order is left exactly as the customer last paid for it — which is the whole point: backing
    /// out of the payment page must leave no trace, not a half-applied order.
    /// </summary>
    public async Task<bool> DiscardAsync(string orderId, string? cashfreeOrderId = null)
    {
        var order = await orderService.GetOrderByIdAsync(orderId);
        if (order?.PendingAmendment == null)
            return false;

        var taken = await orderService.TryTakeAmendmentAsync(orderId, cashfreeOrderId);
        if (taken == null)
            return false;

        var delta = OrderService.StockDelta(order.Items, taken.Items);
        await productService.RestoreStockAsync(
            delta.Where(d => d.Quantity > 0).Select(d => (d.ProductId, d.Quantity)));

        logger.LogInformation(
            "Discarded the unpaid amendment on order {OrderId} ({TopUp} was never paid); the order is unchanged.",
            orderId, taken.TopUpAmount);

        return true;
    }

    /// <summary>
    /// Stands down an order whose payment never happened — declined, or simply walked away from.
    /// Everything the order was holding is given back: the goods to the shelf, and any wallet
    /// credit that was spent on it to the customer's balance. Nothing was captured at the gateway,
    /// so there is nothing there to refund.
    ///
    /// The reason is recorded and shown to the customer verbatim. A customer whose card was
    /// declined and one who closed the tab need to do different things next, and an order that
    /// just says "payment pending" forever tells neither of them anything.
    ///
    /// Safe to call repeatedly: the cancellation is what claims the right to do the rest, so a
    /// retried webhook racing the browser's status check can't restore stock or credit the wallet
    /// twice.
    /// </summary>
    public async Task<bool> FailOrderAsync(string orderId, string? reason)
    {
        var order = await orderService.GetOrderByIdAsync(orderId);
        if (order == null)
            return false;

        // Whatever the customer was part-way through buying dies with the order.
        await DiscardAsync(orderId);

        if (!await orderService.TryCancelAsync(orderId))
            return false; // Already cancelled — somebody else has done all of this.

        await orderService.MarkPaymentFailedAsync(orderId, reason);
        await productService.RestoreStockAsync(order.Items.Select(i => (i.ProductId, i.Quantity)));

        // Wallet credit is real money to the customer even though none left the business. An
        // order that never got paid for must not keep it.
        if (order.WalletAmountApplied > 0 && order.UserId != null)
        {
            await walletService.CreditAsync(
                order.UserId,
                order.WalletAmountApplied,
                WalletTransactionReasons.WalletPortionReturned,
                orderId);
            await orderService.AddRefundedAmountAsync(orderId, order.WalletAmountApplied);
        }

        // Runs after the failure is recorded, which is deliberate: the refresh leaves a "Failed"
        // status alone, so the reason above survives the paid figure being re-derived to zero.
        await orderService.RefreshPaymentStateAsync(orderId);

        logger.LogInformation(
            "Order {OrderId} was never paid for ({Reason}) - cancelled, stock restored, {Wallet} returned to wallet.",
            orderId, reason ?? "no reason given", order.WalletAmountApplied);

        return true;
    }

    /// <summary>Drops amendments nobody ever paid for, so an abandoned edit stops holding stock.
    /// Runs lazily off the customer's own order list rather than as a background job — the orders
    /// have just been read anyway, and there is nothing to sweep for a customer who never edits.</summary>
    public async Task<bool> DiscardExpiredAsync(IEnumerable<Order> orders)
    {
        var discardedAny = false;
        foreach (var order in orders.Where(o => o.PendingAmendment is { } a && a.HasExpired))
        {
            discardedAny |= await DiscardAsync(order.Id!, order.PendingAmendment!.CashfreeOrderId);
        }

        return discardedAny;
    }

    /// <summary>
    /// The backstop for money that arrives with nothing to buy: a top-up paid after its amendment
    /// expired or was discarded (the customer sat on the payment page past the deadline, or a slow
    /// UPI collect finally cleared). The changes are gone, so the order holds more than it costs —
    /// that surplus goes to the customer's wallet rather than sitting on the order looking like
    /// revenue. Idempotent: recording it as refunded brings the paid figure back down, so a second
    /// call finds no surplus.
    /// </summary>
    public async Task ReturnUnappliedOverpaymentAsync(string orderId)
    {
        var order = await orderService.GetOrderByIdAsync(orderId);
        // A live amendment means the money is still expected, so it is not surplus yet.
        if (order?.UserId == null || order.PendingAmendment != null)
            return;

        var cancelled = string.Equals(order.Status, "Cancelled", StringComparison.OrdinalIgnoreCase);

        // A cancelled order costs nothing, so everything it still holds is surplus — except a
        // share already queued for an admin to refund to the original payment method, which is
        // owed to the customer once and must not also be credited here.
        //
        // This is the slow-payment case: a top-up authorised before the customer cancelled, and
        // approved by the bank afterwards. The money lands on an order that has already settled
        // up, and without this it simply stayed there — taken from the customer and never
        // returned.
        var owed = cancelled
            ? order.AmountPaid - (order.RefundPendingAmount ?? 0m)
            : order.AmountPaid - order.TotalAmount;

        var surplus = Math.Round(owed, 2, MidpointRounding.AwayFromZero);
        if (surplus <= 0)
            return;

        await walletService.CreditAsync(
            order.UserId, surplus, WalletTransactionReasons.UnappliedTopUpReturned, orderId);
        await orderService.AddRefundedAmountAsync(orderId, surplus);
        await orderService.RefreshPaymentStateAsync(orderId);

        logger.LogWarning(
            "Order {OrderId} holds {Surplus} it cannot use (cancelled: {Cancelled}) — credited to the customer's wallet.",
            orderId, surplus, cancelled);
    }
}
