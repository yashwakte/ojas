using MongoDB.Driver;
using OjasApi.Models;

namespace OjasApi.Services;

/// <summary>
/// Closed-loop store credit. Balance is spendable on Ojas and never withdrawable to a bank
/// account — that restriction is what keeps this outside RBI's Prepaid Payment Instrument
/// authorisation regime, so no cash-out path should ever be added here.
/// </summary>
public class WalletService(IMongoDbService db)
{
    private readonly IMongoCollection<User> _users = db.Users;
    private readonly IMongoCollection<WalletTransaction> _transactions = db.WalletTransactions;

    public async Task<decimal> GetBalanceAsync(string userId)
    {
        var user = await _users.Find(u => u.Id == userId).FirstOrDefaultAsync();
        return user?.WalletBalance ?? 0m;
    }

    /// <summary>
    /// Adds to a customer's balance and records why. <c>$inc</c> rather than a read-then-write
    /// so two refunds landing at once can't each overwrite the other's result.
    /// </summary>
    public async Task<decimal> CreditAsync(string userId, decimal amount, string reason, string? orderId = null)
    {
        if (amount <= 0)
            throw new ArgumentOutOfRangeException(nameof(amount), "A wallet credit must be positive.");

        var updated = await _users.FindOneAndUpdateAsync<User>(
            u => u.Id == userId,
            Builders<User>.Update.Inc(u => u.WalletBalance, amount),
            new FindOneAndUpdateOptions<User> { ReturnDocument = ReturnDocument.After });

        if (updated == null)
            throw new InvalidOperationException($"Cannot credit the wallet of unknown user {userId}.");

        await RecordAsync(userId, amount, updated.WalletBalance, reason, orderId);
        return updated.WalletBalance;
    }

    /// <summary>
    /// Spends balance, refusing to go negative. The balance check is part of the update filter
    /// rather than a separate read, so two concurrent orders can't both pass a check against the
    /// same balance and overdraw it — the second simply matches nothing and reports failure.
    /// </summary>
    public async Task<bool> TryDebitAsync(string userId, decimal amount, string reason, string? orderId = null)
    {
        if (amount <= 0)
            return true; // Nothing to spend; not a failure.

        var updated = await _users.FindOneAndUpdateAsync<User>(
            Builders<User>.Filter.And(
                Builders<User>.Filter.Eq(u => u.Id, userId),
                Builders<User>.Filter.Gte(u => u.WalletBalance, amount)),
            Builders<User>.Update.Inc(u => u.WalletBalance, -amount),
            new FindOneAndUpdateOptions<User> { ReturnDocument = ReturnDocument.After });

        if (updated == null)
            return false;

        await RecordAsync(userId, -amount, updated.WalletBalance, reason, orderId);
        return true;
    }

    /// <summary>Newest first — this is the customer's statement.</summary>
    public async Task<List<WalletTransaction>> GetTransactionsAsync(string userId, int limit = 50) =>
        await _transactions
            .Find(t => t.UserId == userId)
            .SortByDescending(t => t.CreatedAt)
            .Limit(limit)
            .ToListAsync();

    /// <summary>
    /// How much of a given total this customer's balance can cover.
    ///
    /// Capped so that whatever is left for the gateway is either nothing at all or an amount the
    /// gateway will actually accept. Cashfree refuses any order under ₹1 outright
    /// (<c>order_amount_invalid</c>), so a balance that happened to leave a residual of a few
    /// paise produced an order nobody could ever pay for: the record was created, the stock was
    /// taken, and the customer got "failed to place order" with no way forward. It is a narrow
    /// window, but a balance lands in it exactly whenever a refund has left an odd figure — which
    /// is precisely what cancelling and re-ordering does.
    ///
    /// Resolved in the customer's favour by spending slightly <em>less</em> credit, never more:
    /// they keep the difference in their wallet and the gateway leg becomes payable. Nobody is
    /// charged a rupee more than the order costs.
    /// </summary>
    public static decimal ApplicableAmount(decimal balance, decimal orderTotal)
    {
        var applicable = Math.Max(0m, Math.Min(balance, orderTotal));
        var dueAtGateway = orderTotal - applicable;

        // Covered outright, or leaving enough behind to be chargeable: nothing to adjust.
        if (dueAtGateway <= 0 || dueAtGateway >= OrderPricing.MinimumGatewayAmount)
            return applicable;

        // Hold back just enough credit that the gateway leg clears its minimum. If the order is
        // itself worth less than that minimum there is no split that works, so the wallet takes
        // the whole thing rather than leaving an unpayable remainder.
        var reduced = orderTotal - OrderPricing.MinimumGatewayAmount;
        return reduced <= 0 ? applicable : Math.Round(reduced, 2, MidpointRounding.AwayFromZero);
    }

    private Task RecordAsync(string userId, decimal amount, decimal balanceAfter, string reason, string? orderId) =>
        _transactions.InsertOneAsync(new WalletTransaction
        {
            UserId = userId,
            Amount = amount,
            BalanceAfter = balanceAfter,
            Reason = reason,
            OrderId = orderId,
        });
}
