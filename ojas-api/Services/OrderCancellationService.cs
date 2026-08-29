using OjasApi.Models;

namespace OjasApi.Services;

/// <summary>Who asked for the cancellation. It changes where the money goes, not whether it
/// moves: a customer chooses between wallet credit and their original payment method, whereas a
/// merchant-initiated cancellation always goes back the way it came, because the customer did not
/// ask for this and must not be pushed into store credit for it.</summary>
public enum CancellationInitiator
{
    Customer,
    Admin,
}

/// <summary>What actually happened to the goods and the money, so the caller can say so rather
/// than guess. <see cref="Order"/> is the order as it now stands - cancelling moves far more of it
/// than the status alone.</summary>
public record OrderCancellationResult(
    bool Cancelled,
    Order? Order,
    decimal WalletCredited,
    decimal RefundedToSource,
    decimal SourceRefundQueued,
    string? RefundError = null);

/// <summary>
/// The one place an order is cancelled.
///
/// This exists because there was more than one: the customer's cancel handler returned goods,
/// wallet credit and gateway money, while the admin's status update returned only the goods - so
/// an admin cancelling a paid order took the customer's money and gave back nothing. Restoring
/// stock, dropping an unpaid edit, returning wallet credit and refunding captured money are one
/// operation, and every caller has to run all of it. Keeping them together is what stops the next
/// caller re-implementing three quarters of it.
/// </summary>
public class OrderCancellationService(
    OrderService orderService,
    ProductService productService,
    WalletService walletService,
    CashfreeService cashfreeService,
    OrderPaymentOutcomeService paymentOutcome,
    ILogger<OrderCancellationService> logger)
{
    /// <summary>
    /// Cancels <paramref name="orderId"/> and hands everything back.
    /// </summary>
    /// <param name="onlyFromStatuses">Restricts which statuses may be cancelled from, enforced by
    /// the same write that claims the cancellation rather than by a separate read that can go
    /// stale in between.</param>
    /// <param name="destination">Where the gateway-captured share goes. Ignored for the
    /// wallet-funded share, which can only ever go back to the wallet.</param>
    public async Task<OrderCancellationResult> CancelAsync(
        string orderId,
        CancellationInitiator initiator,
        string destination = RefundDestinations.Wallet,
        IEnumerable<string>? onlyFromStatuses = null)
    {
        var order = await orderService.GetOrderByIdAsync(orderId);
        if (order == null)
            return new OrderCancellationResult(false, null, 0m, 0m, 0m);

        // Claims the right to cancel, atomically. Everything below hands goods and money back, so
        // it must run exactly once: reading the status and writing it afterwards would let two
        // requests sent together both pass, and refund the customer twice.
        if (!await orderService.TryCancelAsync(orderId, onlyFromStatuses))
        {
            var already = await orderService.GetOrderByIdAsync(orderId);
            return new OrderCancellationResult(false, already, 0m, 0m, 0m);
        }

        // An unpaid edit dies with the order, and the stock it was holding comes back with the
        // rest - done before the order's own restore so that isn't measured against a proposal.
        if (order.PendingAmendment != null)
            await paymentOutcome.DiscardAsync(orderId);

        // Cancelled goods go back on the shelf.
        await productService.RestoreStockAsync(order.Items.Select(i => (i.ProductId, i.Quantity)));

        // Re-read: discarding the amendment moves money and stock, and what the order holds now
        // is what there is to give back.
        var live = await orderService.GetOrderByIdAsync(orderId) ?? order;

        var walletCredited = 0m;
        var refundedToSource = 0m;
        var sourceRefundQueued = 0m;
        string? refundError = null;

        // The wallet-funded share can only ever go back to the wallet; the rest follows the
        // destination. Capped at what the order still holds, because a partly refunded order
        // cannot hand the wallet share back twice.
        var walletShare = Math.Min(live.WalletAmountApplied, live.AmountPaid);
        var gatewayShare = Math.Round(live.AmountPaid - walletShare, 2, MidpointRounding.AwayFromZero);

        if (walletShare > 0 && live.UserId != null)
        {
            await walletService.CreditAsync(
                live.UserId, walletShare, WalletTransactionReasons.WalletPortionReturned, orderId);
            await orderService.AddRefundedAmountAsync(orderId, walletShare);
            walletCredited += walletShare;
        }

        if (gatewayShare > 0)
        {
            if (destination == RefundDestinations.Wallet && live.UserId != null)
            {
                await walletService.CreditAsync(
                    live.UserId, gatewayShare, WalletTransactionReasons.OrderCancellationRefund, orderId);
                await orderService.AddRefundedAmountAsync(orderId, gatewayShare);
                walletCredited += gatewayShare;
            }
            else if (initiator == CancellationInitiator.Admin)
            {
                // An admin cancelling *is* the human check that keeps a customer action from
                // moving real money on its own, so the payout goes out now rather than waiting
                // for a second admin to notice it. Anything the gateway would not take is queued
                // instead, so it stays visible and can be retried - never silently dropped.
                var outcome = await RefundToSourceAsync(orderId, gatewayShare, "Order cancelled");
                refundedToSource = outcome.Refunded;
                refundError = outcome.Error;

                var unsent = Math.Round(gatewayShare - refundedToSource, 2, MidpointRounding.AwayFromZero);
                if (unsent > 0)
                {
                    await orderService.SetRefundPendingAsync(orderId, unsent);
                    sourceRefundQueued = unsent;
                }
            }
            else
            {
                // Real money on a customer's say-so, so it waits on a human - the admin refund
                // endpoint does the payout, and only then is it recorded as handed back.
                await orderService.SetRefundPendingAsync(orderId, gatewayShare);
                sourceRefundQueued = gatewayShare;
            }
        }

        var cancelled = await orderService.RefreshPaymentStateAsync(orderId);

        logger.LogInformation(
            "{Initiator} cancelled order {OrderId}: {WalletCredited} to wallet, {Refunded} refunded to source, {Queued} queued for refund.",
            initiator, orderId, walletCredited, refundedToSource, sourceRefundQueued);

        return new OrderCancellationResult(
            true, cancelled, walletCredited, refundedToSource, sourceRefundQueued, refundError);
    }

    public record SourceRefundOutcome(decimal Refunded, string? Error);

    /// <summary>
    /// Sends money back to the original payment method, one gateway call per gateway order that
    /// captured any of it. The split matters: an order that was topped up holds its money across
    /// several gateway orders, and a single refund raised against the original id would take too
    /// much from the first payment and leave the top-up untouched.
    ///
    /// Each leg reserves its amount on the order *before* the payout and releases it if the
    /// gateway refuses, so a failed call never leaves the order believing it refunded money it
    /// never sent, and two refunds issued at the same moment cannot both see the full balance.
    /// </summary>
    public async Task<SourceRefundOutcome> RefundToSourceAsync(string orderId, decimal amount, string? note)
    {
        var order = await orderService.GetOrderByIdAsync(orderId);
        if (order == null)
            return new SourceRefundOutcome(0m, "Order not found.");

        var allocation = OrderService.AllocateSourceRefund(order, amount);
        if (allocation.Count == 0)
            return new SourceRefundOutcome(0m, "This order has no captured gateway payment left to refund.");

        var refunded = 0m;
        string? error = null;
        var leg = 0;

        foreach (var (gatewayOrderId, legAmount) in allocation)
        {
            if (!await orderService.TryReserveRefundAsync(orderId, legAmount))
            {
                error ??= "Refund amount cannot exceed the amount actually paid.";
                break;
            }

            var refundId = $"rf_{gatewayOrderId}_{DateTime.UtcNow:yyyyMMddHHmmssfff}_{leg++}";
            var result = await cashfreeService.CreateRefundAsync(gatewayOrderId, legAmount, refundId, note);

            if (!result.Success)
            {
                // Nothing was sent, so the order must not go on believing it refunded this.
                await orderService.ReleaseReservedRefundAsync(orderId, legAmount);
                error ??= result.Error;
                logger.LogError(
                    "Refund of {Amount} against gateway order {GatewayOrderId} for order {OrderId} failed: {Error}",
                    legAmount, gatewayOrderId, orderId, result.Error);
                break;
            }

            await orderService.RecordGatewayRefundAsync(orderId, new OrderRefund
            {
                RefundId = refundId,
                CashfreeOrderId = gatewayOrderId,
                Amount = legAmount,
                Status = result.RefundStatus,
            });

            refunded = Math.Round(refunded + legAmount, 2, MidpointRounding.AwayFromZero);
        }

        return new SourceRefundOutcome(refunded, refunded > 0 ? null : error);
    }
}
