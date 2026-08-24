using MongoDB.Driver;
using OjasApi.Models;

namespace OjasApi.Services;

public class OrderService(IMongoDbService db)
{
    private readonly IMongoCollection<Order> _orders = db.Orders;

    /// <summary>Cash on Delivery was retired - every new order is paid online.</summary>
    public const string OnlinePaymentMethod = "Cashfree";

    /// <summary>An order whose wallet balance covered the entire total never reaches the gateway.
    /// It stops being one the moment any gateway payment lands against it - see
    /// <see cref="TryRecordPaymentAsync"/>.</summary>
    public const string WalletPaymentMethod = "Wallet";

    public static readonly HashSet<string> AllowedStatuses =
    [
        "Pending",
        "Confirmed",
        "Packed",
        "Shipped",
        "Delivered",
        "Cancelled"
    ];

    /// <summary>
    /// Statuses at which a customer may still change or cancel their own order.
    /// Once it is Packed the goods are physically committed, so the window shuts.
    /// </summary>
    private static readonly HashSet<string> CustomerEditableStatuses =
    [
        "Pending",
        "Confirmed"
    ];

    public static bool IsCustomerEditable(string status) =>
        CustomerEditableStatuses.Contains(NormalizeStatus(status) ?? string.Empty);

    /// <summary>How long an unpaid edit is held before its changes are dropped and the stock it
    /// reserved goes back on the shelf. Long enough to finish a bank's 3-D Secure or a UPI collect
    /// request, short enough that an abandoned payment page doesn't hold goods all day.</summary>
    public static readonly TimeSpan AmendmentLifetime = TimeSpan.FromMinutes(30);

    /// <summary>Net stock change per product between two versions of an order's items: positive
    /// means more has to come off the shelf, negative means some goes back.</summary>
    public static List<(string ProductId, int Quantity, string ProductName)> StockDelta(
        List<OrderItem> before,
        List<OrderItem> after)
    {
        var deltas = new Dictionary<string, (int Quantity, string Name)>();

        foreach (var item in after)
        {
            deltas.TryGetValue(item.ProductId, out var current);
            deltas[item.ProductId] = (current.Quantity + item.Quantity, item.ProductName);
        }

        foreach (var item in before)
        {
            deltas.TryGetValue(item.ProductId, out var current);
            deltas[item.ProductId] = (current.Quantity - item.Quantity, current.Name ?? item.ProductName);
        }

        return deltas
            .Where(kv => kv.Value.Quantity != 0)
            .Select(kv => (kv.Key, kv.Value.Quantity, kv.Value.Name))
            .ToList();
    }

    // "Collected" is legacy COD cash-in-hand, kept for orders placed before COD was retired.
    // "Paid"/"Failed" are the Cashfree outcomes, driven by the webhook or a server-side status
    // query - never by the customer-facing redirect. "PartiallyPaid" is an order whose total was
    // raised by an edit past what has actually been captured, so the top-up is still outstanding;
    // it exists so an admin never mistakes an underpaid order for a settled one.
    public static readonly HashSet<string> AllowedPaymentStatuses =
        ["Pending", "Collected", "Paid", "PartiallyPaid", "Failed"];

    public async Task<Order> CreateOrderAsync(Order order)
    {
        await _orders.InsertOneAsync(order);
        return order;
    }

    /// <summary>
    /// Replaces the mutable parts of an order (items, delivery details) and the
    /// recomputed money. Guarded by status so a packed order can't shift underneath
    /// the person picking it.
    /// </summary>
    public async Task<bool> UpdateOrderContentsAsync(
        string orderId,
        List<OrderItem> items,
        string fullName,
        string phone,
        string address,
        double latitude,
        double longitude,
        string? addressMapLink,
        string notes,
        decimal subtotal,
        string? couponCode,
        decimal discountPercentage,
        decimal discountAmount,
        decimal deliveryCharge,
        double deliveryDistanceKm,
        decimal totalAmount)
    {
        var update = Builders<Order>.Update
            .Set(o => o.Items, items)
            .Set(o => o.FullName, fullName)
            .Set(o => o.Phone, phone)
            .Set(o => o.Address, address)
            .Set(o => o.Latitude, latitude)
            .Set(o => o.Longitude, longitude)
            .Set(o => o.AddressMapLink, addressMapLink)
            .Set(o => o.Notes, notes)
            .Set(o => o.Subtotal, subtotal)
            .Set(o => o.CouponCode, couponCode)
            .Set(o => o.DiscountPercentage, discountPercentage)
            .Set(o => o.DiscountAmount, discountAmount)
            .Set(o => o.DeliveryCharge, deliveryCharge)
            .Set(o => o.DeliveryDistanceKm, deliveryDistanceKm)
            .Set(o => o.TotalAmount, totalAmount)
            .Set(o => o.UpdatedAt, DateTime.UtcNow);

        var result = await _orders.UpdateOneAsync(o => o.Id == orderId, update);
        return result.MatchedCount > 0;
    }

    /// <summary>
    /// The customer's own order list. A failed attempt that has since been retried is left out:
    /// they want to see the order they are actually trying to place, not the trail of dead
    /// attempts behind it. Admins get the full history from <see cref="GetAllOrdersAsync"/>,
    /// because support does need that trail.
    /// </summary>
    public async Task<List<Order>> GetOrdersByUserAsync(string userId)
    {
        return await _orders
            .Find(o => o.UserId == userId && o.ReplacedByOrderId == null)
            .SortByDescending(o => o.CreatedAt)
            .ToListAsync();
    }

    /// <summary>Points a failed order at the one placed to replace it, retiring it from the
    /// customer's list. Refuses anything that isn't that customer's own failed order, so the id
    /// coming from the browser can't be used to hide someone else's order — or a live one.</summary>
    public async Task<bool> MarkReplacedByAsync(string failedOrderId, string replacementOrderId, string userId)
    {
        var result = await _orders.UpdateOneAsync(
            Builders<Order>.Filter.And(
                Builders<Order>.Filter.Eq(o => o.Id, failedOrderId),
                Builders<Order>.Filter.Eq(o => o.UserId, userId),
                Builders<Order>.Filter.Eq(o => o.PaymentStatus, "Failed"),
                Builders<Order>.Filter.Eq(o => o.ReplacedByOrderId, null)),
            Builders<Order>.Update
                .Set(o => o.ReplacedByOrderId, replacementOrderId)
                .Set(o => o.UpdatedAt, DateTime.UtcNow));

        return result.ModifiedCount > 0;
    }

    public async Task<List<Order>> GetAllOrdersAsync()
    {
        return await _orders.Find(Builders<Order>.Filter.Empty).SortByDescending(o => o.CreatedAt).ToListAsync();
    }

    public async Task<List<Order>> GetOrdersAssignedToDeliveryAsync(string deliveryPartnerId)
    {
        return await _orders
            .Find(o => o.DeliveryPartnerId == deliveryPartnerId)
            .SortByDescending(o => o.CreatedAt)
            .ToListAsync();
    }

    public async Task<Order?> GetOrderByIdAsync(string orderId)
    {
        return await _orders.Find(o => o.Id == orderId).FirstOrDefaultAsync();
    }

    public async Task<bool> UpdateOrderStatusAsync(string orderId, string status)
    {
        var normalizedStatus = NormalizeStatus(status);
        if (normalizedStatus == null)
            return false;

        var update = Builders<Order>.Update
            .Set(o => o.Status, normalizedStatus)
            .Set(o => o.UpdatedAt, DateTime.UtcNow);

        var result = await _orders.UpdateOneAsync(o => o.Id == orderId, update);
        return result.MatchedCount > 0;
    }

    /// <summary>Recorded by the delivery partner once cash actually changes hands - a
    /// separate action from marking the order Delivered, since a partner can deliver
    /// without successfully collecting (a dispute, no cash on hand) and that has to stay
    /// visible rather than being masked by the delivery status alone.</summary>
    public async Task<bool> MarkPaymentCollectedAsync(string orderId)
    {
        var update = Builders<Order>.Update
            .Set(o => o.PaymentStatus, "Collected")
            .Set(o => o.UpdatedAt, DateTime.UtcNow);

        var result = await _orders.UpdateOneAsync(o => o.Id == orderId, update);
        return result.MatchedCount > 0;
    }

    /// <summary>Records wallet credit spent on an order. Payment method and status come along
    /// because a wallet balance covering the whole total settles the order outright, with no
    /// gateway payment to wait on.</summary>
    public async Task<bool> ApplyWalletPaymentAsync(
        string orderId, decimal walletApplied, string paymentMethod, string paymentStatus)
    {
        var update = Builders<Order>.Update
            .Set(o => o.WalletAmountApplied, walletApplied)
            .Set(o => o.AmountPaid, walletApplied)
            .Set(o => o.PaymentMethod, paymentMethod)
            .Set(o => o.PaymentStatus, paymentStatus)
            .Set(o => o.UpdatedAt, DateTime.UtcNow);

        var result = await _orders.UpdateOneAsync(o => o.Id == orderId, update);
        return result.MatchedCount > 0;
    }

    public async Task<bool> SetPaymentSessionAsync(string orderId, string paymentSessionId)
    {
        var update = Builders<Order>.Update
            .Set(o => o.PaymentSessionId, paymentSessionId)
            .Set(o => o.UpdatedAt, DateTime.UtcNow);

        var result = await _orders.UpdateOneAsync(o => o.Id == orderId, update);
        return result.MatchedCount > 0;
    }

    /// <summary>
    /// Records one captured gateway payment. Driven by a verified webhook or an explicit
    /// server-side status query — never by the customer's browser redirect, which proves nothing
    /// about whether the bank approved the charge.
    ///
    /// Idempotent on Cashfree's payment id: the filter refuses to match an order that already
    /// holds that id, so a webhook retry (Cashfree retries until it gets a 2xx) or a repeated
    /// status check records the money once. Returns false when it was already known.
    /// </summary>
    public async Task<bool> TryRecordPaymentAsync(string orderId, OrderPayment payment)
    {
        var alreadyRecorded = Builders<Order>.Filter.ElemMatch(
            o => o.Payments, p => p.CfPaymentId == payment.CfPaymentId);

        var result = await _orders.UpdateOneAsync(
            Builders<Order>.Filter.And(
                Builders<Order>.Filter.Eq(o => o.Id, orderId),
                Builders<Order>.Filter.Not(alreadyRecorded)),
            Builders<Order>.Update
                .Push(o => o.Payments, payment)
                // Kept for at-a-glance display; the Payments list is the record.
                .Set(o => o.CfPaymentId, payment.CfPaymentId)
                .Set(o => o.PaymentInstrument, payment.Instrument)
                .Set(o => o.UpdatedAt, DateTime.UtcNow));

        return result.ModifiedCount > 0;
    }

    /// <summary>Notes another gateway order the customer has been asked to pay, so a later status
    /// check knows to ask Cashfree about it. Without this a top-up is invisible: it lives under a
    /// different gateway order id than the one the order started with.</summary>
    public async Task<bool> AddPaymentAttemptAsync(string orderId, string cashfreeOrderId, decimal amount)
    {
        var update = Builders<Order>.Update
            .Push(o => o.PaymentAttempts, new PaymentAttempt
            {
                CashfreeOrderId = cashfreeOrderId,
                Amount = amount,
            })
            .Set(o => o.UpdatedAt, DateTime.UtcNow);

        var result = await _orders.UpdateOneAsync(o => o.Id == orderId, update);
        return result.MatchedCount > 0;
    }

    /// <summary>Parks a priced-but-unpaid edit against the order. Nothing the customer can see on
    /// the order itself changes until the top-up is paid.</summary>
    public async Task<bool> SetPendingAmendmentAsync(string orderId, OrderAmendment amendment)
    {
        var update = Builders<Order>.Update
            .Set(o => o.PendingAmendment, amendment)
            .Set(o => o.UpdatedAt, DateTime.UtcNow);

        var result = await _orders.UpdateOneAsync(o => o.Id == orderId, update);
        return result.MatchedCount > 0;
    }

    /// <summary>
    /// Removes the pending amendment and hands it back, or returns null if there wasn't one (or
    /// somebody else took it first). The removal and the read are a single atomic operation on
    /// purpose: a webhook and a browser status check routinely arrive at the same moment, and
    /// whichever loses this race must do nothing rather than release the reserved stock a second
    /// time or apply the same changes twice.
    /// </summary>
    /// <param name="cashfreeOrderId">When given, only an amendment awaiting that exact gateway
    /// order is taken — so a callback for a stale top-up can't discard a newer edit.</param>
    public async Task<OrderAmendment?> TryTakeAmendmentAsync(string orderId, string? cashfreeOrderId = null)
    {
        var filter = Builders<Order>.Filter.And(
            Builders<Order>.Filter.Eq(o => o.Id, orderId),
            Builders<Order>.Filter.Ne(o => o.PendingAmendment, null));

        if (cashfreeOrderId != null)
        {
            filter &= Builders<Order>.Filter.Eq(
                "pendingAmendment.cashfreeOrderId", cashfreeOrderId);
        }

        var before = await _orders.FindOneAndUpdateAsync(
            filter,
            Builders<Order>.Update
                .Unset(o => o.PendingAmendment)
                .Set(o => o.UpdatedAt, DateTime.UtcNow),
            new FindOneAndUpdateOptions<Order> { ReturnDocument = ReturnDocument.Before });

        return before?.PendingAmendment;
    }

    /// <summary>Copies a paid-for amendment over the order it belongs to.</summary>
    public Task<bool> ApplyAmendmentAsync(string orderId, OrderAmendment amendment) =>
        UpdateOrderContentsAsync(
            orderId,
            amendment.Items,
            amendment.FullName,
            amendment.Phone,
            amendment.Address,
            amendment.Latitude,
            amendment.Longitude,
            amendment.AddressMapLink,
            amendment.Notes,
            amendment.Subtotal,
            amendment.CouponCode,
            amendment.DiscountPercentage,
            amendment.DiscountAmount,
            amendment.DeliveryCharge,
            amendment.DeliveryDistanceKm,
            amendment.TotalAmount);

    /// <summary>
    /// Claims the right to refund <paramref name="amount"/>, atomically, and reports whether this
    /// call got it. The cap is part of the write: reading what an order holds and then paying out
    /// afterwards lets two refunds issued together each see the full balance and each pay out, so
    /// an order could be refunded past what it ever captured. Only matches while the order still
    /// holds at least that much, and moves it to refunded in the same operation.
    /// </summary>
    public async Task<bool> TryReserveRefundAsync(string orderId, decimal amount)
    {
        if (amount <= 0)
            return false;

        var result = await _orders.UpdateOneAsync(
            Builders<Order>.Filter.And(
                Builders<Order>.Filter.Eq(o => o.Id, orderId),
                Builders<Order>.Filter.Gte(o => o.AmountPaid, amount)),
            Builders<Order>.Update
                .Inc(o => o.AmountRefunded, amount)
                .Inc(o => o.AmountPaid, -amount)
                .Set(o => o.UpdatedAt, DateTime.UtcNow));

        return result.ModifiedCount > 0;
    }

    /// <summary>Hands a reserved refund back when the payout itself failed, so a gateway error
    /// doesn't leave the order permanently believing it refunded money it never sent.</summary>
    public Task ReleaseReservedRefundAsync(string orderId, decimal amount) =>
        _orders.UpdateOneAsync(
            Builders<Order>.Filter.Eq(o => o.Id, orderId),
            Builders<Order>.Update
                .Inc(o => o.AmountRefunded, -amount)
                .Inc(o => o.AmountPaid, amount)
                .Set(o => o.UpdatedAt, DateTime.UtcNow));

    /// <summary>Adds to what has been handed back, so the paid figure falls without any record
    /// of the original capture being rewritten.</summary>
    public async Task<bool> AddRefundedAmountAsync(string orderId, decimal amount)
    {
        var update = Builders<Order>.Update
            .Inc(o => o.AmountRefunded, amount)
            .Set(o => o.UpdatedAt, DateTime.UtcNow);

        var result = await _orders.UpdateOneAsync(o => o.Id == orderId, update);
        return result.MatchedCount > 0;
    }

    /// <summary>
    /// Re-derives the paid figure and payment status from the order's own records, and stores
    /// them. Call after anything that changes payments, refunds or the total. "PartiallyPaid"
    /// means money is outstanding, so an admin never mistakes an underpaid order for a settled
    /// one; "Paid" only once what the order holds covers its total.
    /// </summary>
    public async Task<Order?> RefreshPaymentStateAsync(string orderId)
    {
        var order = await GetOrderByIdAsync(orderId);
        if (order == null) return null;

        var amountPaid = order.RecomputeAmountPaid();
        var status = order.PaymentStatus;

        // A cancelled or never-started order keeps whatever status it had; only an order with
        // money against it, or one still awaiting payment, is described in these terms.
        if (!string.Equals(status, "Failed", StringComparison.Ordinal))
        {
            status = amountPaid >= order.TotalAmount && amountPaid > 0
                ? "Paid"
                : amountPaid > 0
                    ? "PartiallyPaid"
                    : "Pending";
        }

        // An order the wallet paid for outright stops being one the moment real money goes through
        // the gateway against it — which is exactly what a top-up on a wallet-paid order is. Left
        // alone it would keep telling the customer it was "paid from wallet" when they had just
        // put part of it on a card, and the admin refund endpoint would refuse to touch gateway
        // money the order really holds.
        var method = order.PaymentMethod;
        if (string.Equals(method, WalletPaymentMethod, StringComparison.Ordinal) && order.Payments.Count > 0)
            method = OnlinePaymentMethod;

        await _orders.UpdateOneAsync(
            o => o.Id == orderId,
            Builders<Order>.Update
                .Set(o => o.AmountPaid, amountPaid)
                .Set(o => o.PaymentStatus, status)
                .Set(o => o.PaymentMethod, method)
                .Set(o => o.UpdatedAt, DateTime.UtcNow));

        order.AmountPaid = amountPaid;
        order.PaymentStatus = status;
        order.PaymentMethod = method;
        return order;
    }

    /// <summary>Queued by a cancellation where the customer asked for their money back on the
    /// original payment method; cleared once an admin actually issues the refund. Null means
    /// nothing is owed back.</summary>
    public async Task<bool> SetRefundPendingAsync(string orderId, decimal? amount)
    {
        var update = Builders<Order>.Update
            .Set(o => o.RefundPendingAmount, amount)
            .Set(o => o.UpdatedAt, DateTime.UtcNow);

        var result = await _orders.UpdateOneAsync(o => o.Id == orderId, update);
        return result.MatchedCount > 0;
    }

    /// <summary>
    /// Moves an order to Cancelled and reports whether <em>this</em> call is the one that did it.
    ///
    /// The check and the write are deliberately a single atomic operation. Everything that
    /// follows a cancellation — restoring stock, crediting the wallet, queueing a refund — must
    /// happen exactly once, and reading the status first and writing it afterwards is not enough:
    /// two requests firing together both read "not cancelled", both pass, and both hand the money
    /// back. Sending a handful of parallel cancels was a way to be refunded several times over.
    /// </summary>
    /// <param name="onlyFromStatuses">When given, the cancellation only happens from one of these
    /// statuses, so the eligibility rule is enforced by the same write that claims the right to
    /// act rather than by a separate read that can go stale in between.</param>
    public async Task<bool> TryCancelAsync(string orderId, IEnumerable<string>? onlyFromStatuses = null)
    {
        var filter = Builders<Order>.Filter.And(
            Builders<Order>.Filter.Eq(o => o.Id, orderId),
            Builders<Order>.Filter.Ne(o => o.Status, "Cancelled"));

        if (onlyFromStatuses is not null)
            filter &= Builders<Order>.Filter.In(o => o.Status, onlyFromStatuses);

        var result = await _orders.UpdateOneAsync(
            filter,
            Builders<Order>.Update
                .Set(o => o.Status, "Cancelled")
                .Set(o => o.UpdatedAt, DateTime.UtcNow));

        return result.ModifiedCount > 0;
    }

    /// <summary>The statuses a customer may still cancel from, for callers that need to enforce
    /// it inside an atomic write rather than as a separate read.</summary>
    public static IReadOnlyCollection<string> CustomerCancellableStatuses => CustomerEditableStatuses;

    /// <summary>Records that a payment definitively failed, along with why. The reason is stored
    /// so the customer is told what actually happened rather than a generic guess.</summary>
    public async Task<bool> MarkPaymentFailedAsync(string orderId, string? reason = null)
    {
        var update = Builders<Order>.Update
            .Set(o => o.PaymentStatus, "Failed")
            .Set(o => o.PaymentFailureReason, reason)
            .Set(o => o.UpdatedAt, DateTime.UtcNow);

        var result = await _orders.UpdateOneAsync(o => o.Id == orderId, update);
        return result.MatchedCount > 0;
    }

    public async Task<bool> AssignDeliveryPartnerAsync(string orderId, string deliveryPartnerId, string deliveryPartnerName)
    {
        var update = Builders<Order>.Update
            .Set(o => o.DeliveryPartnerId, deliveryPartnerId)
            .Set(o => o.DeliveryPartnerName, deliveryPartnerName)
            .Set(o => o.UpdatedAt, DateTime.UtcNow);

        var result = await _orders.UpdateOneAsync(o => o.Id == orderId, update);
        return result.MatchedCount > 0;
    }

    public static string? NormalizeStatus(string status)
    {
        if (string.IsNullOrWhiteSpace(status))
            return null;

        var normalized = status.Trim();
        var matched = AllowedStatuses.FirstOrDefault(s => s.Equals(normalized, StringComparison.OrdinalIgnoreCase));
        return matched;
    }
}
