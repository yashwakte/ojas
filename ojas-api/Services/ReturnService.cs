using MongoDB.Driver;
using OjasApi.Models;

namespace OjasApi.Services;

/// <summary>One product on a delivered order, and how much of it can still be sent back.</summary>
public record ReturnableItem(
    string ProductId,
    string ProductName,
    string Weight,
    decimal Price,
    int OrderedQuantity,
    int ReturnableQuantity,
    decimal UnitRefund);

/// <summary>
/// Whether an order can be returned from at all, and what of it.
///
/// Computed server-side and handed to the customer whole, so the button they see and the rule the
/// API enforces are the same rule. <see cref="Reason"/> is written to be shown verbatim: a
/// disabled button with no explanation is the thing that generates the support call this feature
/// exists to avoid.
/// </summary>
public record ReturnEligibility(
    bool CanRequest,
    string? Reason,
    DateTime? WindowEndsAt,
    decimal Refundable,
    List<ReturnableItem> Items);

/// <summary>What settling a return actually did with the money.</summary>
public record ReturnSettlement(
    bool Settled,
    ReturnRequest? Request,
    decimal WalletCredited,
    decimal RefundedToSource,
    decimal RefundQueued,
    string? RefundError = null);

/// <summary>
/// The whole life of a return request: what may be returned, raising one, and settling it.
///
/// The money is not moved here. Settling routes through <see cref="OrderCancellationService"/>'s
/// refund path and <see cref="WalletService"/>, exactly as a cancellation does, so an order's
/// refunded total, its per-gateway-order refundable balance and the wallet ledger stay derived
/// from a single implementation. Cancellation on this codebase once had three partial
/// implementations and a customer got nothing back from one of them; returns do not get to
/// repeat that.
/// </summary>
public class ReturnService(
    IMongoDbService db,
    OrderService orderService,
    OrderCancellationService cancellationService,
    WalletService walletService,
    ProductService productService,
    ILogger<ReturnService> logger)
{
    private readonly IMongoCollection<ReturnRequest> _returns = db.ReturnRequests;

    /// <summary>Every request against an order that still holds its items - anything not
    /// rejected or cancelled. What is left of each line is the ordered quantity less these.</summary>
    private async Task<List<ReturnRequest>> LiveRequestsForOrderAsync(string orderId)
    {
        var all = await _returns.Find(r => r.OrderId == orderId).ToListAsync();
        return all.Where(r => ReturnRequestStatuses.IsLive(r.Status)).ToList();
    }

    /// <summary>
    /// What, if anything, <paramref name="order"/> can have returned from it right now.
    /// </summary>
    public async Task<ReturnEligibility> GetEligibilityAsync(Order order)
    {
        var none = new List<ReturnableItem>();

        if (!string.Equals(order.Status, "Delivered", StringComparison.OrdinalIgnoreCase))
        {
            return new ReturnEligibility(
                false,
                order.Status is "Cancelled"
                    ? "This order was cancelled, so there is nothing to return."
                    : "You can request a return once your order has been delivered.",
                null, 0m, none);
        }

        var windowEndsAt = ReturnPolicy.WindowEndsAt(order.ReturnWindowStartsAt);

        if (!ReturnPolicy.IsWithinWindow(order.ReturnWindowStartsAt, DateTime.UtcNow))
        {
            return new ReturnEligibility(
                false,
                $"The {ReturnPolicy.WindowDays}-day return window for this order closed on " +
                $"{windowEndsAt:d MMM yyyy}. Please call us if something is wrong - we will still help.",
                windowEndsAt, 0m, none);
        }

        var refundable = ReturnPricing.Refundable(order);
        if (refundable <= 0)
        {
            // A legacy cash order, or one already refunded in full. Saying so plainly beats a
            // button that fails at the end of the flow.
            return new ReturnEligibility(
                false,
                "There is nothing left to refund on this order. Please call us and we will sort it out.",
                windowEndsAt, 0m, none);
        }

        var live = await LiveRequestsForOrderAsync(order.Id!);
        var claimed = new Dictionary<string, int>(StringComparer.Ordinal);
        foreach (var item in live.SelectMany(r => r.Items))
        {
            claimed.TryGetValue(item.ProductId, out var already);
            claimed[item.ProductId] = already + item.Quantity;
        }

        var items = order.Items
            .Select(i =>
            {
                claimed.TryGetValue(i.ProductId, out var alreadyClaimed);
                var remaining = Math.Max(0, i.Quantity - alreadyClaimed);
                return new ReturnableItem(
                    i.ProductId,
                    i.ProductName,
                    i.Weight,
                    i.Price,
                    i.Quantity,
                    remaining,
                    ReturnPricing.LineRefund(order, i, 1));
            })
            .ToList();

        if (items.All(i => i.ReturnableQuantity == 0))
        {
            return new ReturnEligibility(
                false,
                "Every item on this order already has a return in progress.",
                windowEndsAt, refundable, items);
        }

        return new ReturnEligibility(true, null, windowEndsAt, refundable, items);
    }

    public async Task<ReturnEligibility?> GetEligibilityAsync(string orderId, string userId)
    {
        var order = await orderService.GetOrderByIdAsync(orderId);
        // Somebody else's order is answered as a missing one, the same way the rest of this API
        // answers it - a 403 would confirm that the guessed id is a real order.
        if (order == null || !string.Equals(order.UserId, userId, StringComparison.Ordinal))
            return null;

        return await GetEligibilityAsync(order);
    }

    public record CreateOutcome(ReturnRequest? Request, string? Error);

    /// <summary>
    /// Raises a return for part of a delivered order.
    ///
    /// Everything the customer sent is re-derived here rather than trusted: which lines exist,
    /// what is left of them, and what they are worth. The browser sends quantities and a reason,
    /// nothing else - a request that named its own refund amount would be a self-service
    /// withdrawal from the business.
    /// </summary>
    public async Task<CreateOutcome> CreateAsync(
        string orderId,
        string userId,
        IReadOnlyList<(string ProductId, int Quantity)> requested,
        string reason,
        string? comment,
        string refundDestination)
    {
        var order = await orderService.GetOrderByIdAsync(orderId);
        if (order == null || !string.Equals(order.UserId, userId, StringComparison.Ordinal))
            return new CreateOutcome(null, "Order not found.");

        var eligibility = await GetEligibilityAsync(order);
        if (!eligibility.CanRequest)
            return new CreateOutcome(null, eligibility.Reason ?? "This order cannot be returned.");

        var normalizedReason = ReturnReasons.Normalize(reason);
        if (normalizedReason == null)
            return new CreateOutcome(null, "Please choose a reason for the return.");

        if (!RefundDestinations.IsValid(refundDestination))
            return new CreateOutcome(null, "Choose where the refund should go.");

        var lines = new List<ReturnRequestItem>();
        foreach (var (productId, quantity) in requested)
        {
            if (quantity <= 0) continue;

            var eligible = eligibility.Items.FirstOrDefault(i => i.ProductId == productId);
            if (eligible == null)
                return new CreateOutcome(null, "That item is not on this order.");

            if (quantity > eligible.ReturnableQuantity)
            {
                return new CreateOutcome(null,
                    eligible.ReturnableQuantity == 0
                        ? $"{eligible.ProductName} already has a return in progress."
                        : $"You can return at most {eligible.ReturnableQuantity} of {eligible.ProductName}.");
            }

            var orderItem = order.Items.First(i => i.ProductId == productId);
            lines.Add(new ReturnRequestItem
            {
                ProductId = productId,
                ProductName = orderItem.ProductName,
                Weight = orderItem.Weight,
                Price = orderItem.Price,
                Quantity = quantity,
                RefundAmount = ReturnPricing.LineRefund(order, orderItem, quantity),
            });
        }

        if (lines.Count == 0)
            return new CreateOutcome(null, "Choose at least one item to return.");

        // The total is capped at what the order can still hand back, so the figure promised to
        // the customer is one the order can actually honour even if two returns are raised at
        // once. Settling caps again against the live order, since this one is only a promise.
        var total = ReturnPricing.CapToRefundable(order, lines.Sum(l => l.RefundAmount));

        var request = new ReturnRequest
        {
            OrderId = orderId,
            UserId = userId,
            CustomerName = order.FullName,
            CustomerPhone = order.Phone,
            PickupAddress = order.Address,
            Items = lines,
            Reason = normalizedReason,
            Comment = string.IsNullOrWhiteSpace(comment) ? null : comment.Trim(),
            RefundDestination = refundDestination,
            RefundAmount = total,
            Status = ReturnRequestStatuses.Requested,
            Events =
            [
                new ReturnRequestEvent
                {
                    Status = ReturnRequestStatuses.Requested,
                    By = "customer",
                    Note = null,
                },
            ],
        };

        await _returns.InsertOneAsync(request);

        logger.LogInformation(
            "Return {ReturnId} raised on order {OrderId}: {Units} unit(s), {Amount} to {Destination}.",
            request.Id, orderId, request.TotalQuantity, total, refundDestination);

        return new CreateOutcome(request, null);
    }

    public async Task<ReturnRequest?> GetByIdAsync(string id) =>
        await _returns.Find(r => r.Id == id).FirstOrDefaultAsync();

    public async Task<List<ReturnRequest>> GetMineAsync(string userId) =>
        await _returns.Find(r => r.UserId == userId)
            .SortByDescending(r => r.CreatedAt)
            .ToListAsync();

    public async Task<List<ReturnRequest>> GetForOrderAsync(string orderId, string userId) =>
        await _returns.Find(r => r.OrderId == orderId && r.UserId == userId)
            .SortByDescending(r => r.CreatedAt)
            .ToListAsync();

    public async Task<List<ReturnRequest>> GetAllForAdminAsync() =>
        await _returns.Find(Builders<ReturnRequest>.Filter.Empty)
            .SortByDescending(r => r.CreatedAt)
            .ToListAsync();

    /// <summary>
    /// Moves a request from one status to another, refusing anything that is not a step the flow
    /// allows. The check and the write are one operation: two admins clicking Refund together
    /// must not both get through, because the second would pay the customer twice.
    /// </summary>
    private async Task<ReturnRequest?> TryTransitionAsync(
        string id, string[] from, string to, string by, string? note)
    {
        var update = Builders<ReturnRequest>.Update
            .Set(r => r.Status, to)
            .Set(r => r.UpdatedAt, DateTime.UtcNow)
            .Push(r => r.Events, new ReturnRequestEvent { Status = to, By = by, Note = note });

        return await _returns.FindOneAndUpdateAsync<ReturnRequest>(
            Builders<ReturnRequest>.Filter.And(
                Builders<ReturnRequest>.Filter.Eq(r => r.Id, id),
                Builders<ReturnRequest>.Filter.In(r => r.Status, from)),
            update,
            new FindOneAndUpdateOptions<ReturnRequest> { ReturnDocument = ReturnDocument.After });
    }

    /// <summary>The customer changing their mind. Only before we have collected: once the pack is
    /// with us, cancelling would leave the goods here and the money with them.</summary>
    public async Task<ReturnRequest?> CancelByCustomerAsync(string id, string userId)
    {
        var existing = await GetByIdAsync(id);
        if (existing == null || !string.Equals(existing.UserId, userId, StringComparison.Ordinal))
            return null;

        return await TryTransitionAsync(
            id,
            [ReturnRequestStatuses.Requested, ReturnRequestStatuses.Approved],
            ReturnRequestStatuses.Cancelled,
            "customer",
            null);
    }

    public async Task<ReturnRequest?> ApproveAsync(string id, string? note) =>
        await TryTransitionAsync(
            id, [ReturnRequestStatuses.Requested], ReturnRequestStatuses.Approved, "admin", note);

    public async Task<ReturnRequest?> MarkPickedUpAsync(string id, string? note) =>
        await TryTransitionAsync(
            id,
            [ReturnRequestStatuses.Requested, ReturnRequestStatuses.Approved],
            ReturnRequestStatuses.PickedUp,
            "admin",
            note);

    /// <summary>Refusing a return. Allowed right up until it is refunded - a pack can turn out to
    /// be opened once it is back with us, and that is precisely when we find out.</summary>
    public async Task<ReturnRequest?> RejectAsync(string id, string reason) =>
        await TryTransitionAsync(
            id,
            [ReturnRequestStatuses.Requested, ReturnRequestStatuses.Approved, ReturnRequestStatuses.PickedUp],
            ReturnRequestStatuses.Rejected,
            "admin",
            reason);

    /// <summary>
    /// Hands the money back and closes the return.
    ///
    /// Only from PickedUp: the goods have to be with us before the money leaves, which is the
    /// entire reason the flow has a pickup step. The status is claimed first, by a filtered
    /// update, so the refund below can only ever run once however many admins press the button.
    /// </summary>
    public async Task<ReturnSettlement> RefundAsync(string id)
    {
        var claimed = await TryTransitionAsync(
            id, [ReturnRequestStatuses.PickedUp], ReturnRequestStatuses.Refunded, "admin", null);

        if (claimed == null)
        {
            var current = await GetByIdAsync(id);
            return new ReturnSettlement(false, current, 0m, 0m, 0m,
                current == null
                    ? "Return request not found."
                    : current.Status == ReturnRequestStatuses.Refunded
                        ? "This return has already been refunded."
                        : "Mark the items as picked up before refunding them.");
        }

        var order = await orderService.GetOrderByIdAsync(claimed.OrderId);
        if (order == null)
        {
            logger.LogError("Return {ReturnId} refers to missing order {OrderId}.", id, claimed.OrderId);
            return new ReturnSettlement(false, claimed, 0m, 0m, 0m, "The order behind this return no longer exists.");
        }

        // Capped against the order as it stands now, not as it stood when the request was raised.
        // An order can have been refunded in the meantime - another return, a partial refund by
        // hand - and a return must never pay out money the order no longer holds.
        var amount = ReturnPricing.CapToRefundable(order, claimed.RefundAmount);

        var walletCredited = 0m;
        var refundedToSource = 0m;
        var queued = 0m;
        string? error = null;

        if (amount <= 0)
        {
            error = "This order has no refundable balance left.";
        }
        else if (claimed.RefundDestination == RefundDestinations.Wallet && order.UserId != null)
        {
            await walletService.CreditAsync(
                order.UserId, amount, WalletTransactionReasons.ReturnRefund, order.Id);
            await orderService.AddRefundedAmountAsync(order.Id!, amount);
            walletCredited = amount;
        }
        else
        {
            // An admin pressing Refund is the human check that keeps a customer action from moving
            // real money, so the payout goes out now rather than waiting for a second admin.
            // Anything the gateway will not take is queued and stays visible - never dropped.
            var outcome = await cancellationService.RefundToSourceAsync(
                order.Id!, amount, $"Return of {claimed.TotalQuantity} item(s)");

            refundedToSource = outcome.Refunded;
            error = outcome.Error;

            var unsent = Math.Round(amount - refundedToSource, 2, MidpointRounding.AwayFromZero);
            if (unsent > 0)
            {
                await orderService.SetRefundPendingAsync(order.Id!, unsent);
                queued = unsent;
            }
        }

        // Returned packs are unopened by the terms of the policy, so they go back on the shelf.
        // Untracked products - which is all of them at the owner's instruction - ignore this.
        if (walletCredited > 0 || refundedToSource > 0)
        {
            await productService.RestoreStockAsync(
                claimed.Items.Select(i => (i.ProductId, i.Quantity)));
        }

        await orderService.RefreshPaymentStateAsync(order.Id!);

        var settled = await _returns.FindOneAndUpdateAsync<ReturnRequest>(
            r => r.Id == id,
            Builders<ReturnRequest>.Update
                .Set(r => r.RefundedToWallet, walletCredited)
                .Set(r => r.RefundedToSource, refundedToSource)
                .Set(r => r.RefundQueued, queued)
                .Set(r => r.UpdatedAt, DateTime.UtcNow),
            new FindOneAndUpdateOptions<ReturnRequest> { ReturnDocument = ReturnDocument.After });

        logger.LogInformation(
            "Return {ReturnId} on order {OrderId} settled: {Wallet} to wallet, {Source} to source, {Queued} queued.",
            id, claimed.OrderId, walletCredited, refundedToSource, queued);

        return new ReturnSettlement(true, settled ?? claimed, walletCredited, refundedToSource, queued, error);
    }
}
