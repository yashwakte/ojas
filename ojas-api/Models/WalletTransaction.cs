using MongoDB.Bson;
using MongoDB.Bson.Serialization.Attributes;

namespace OjasApi.Models;

public static class WalletTransactionReasons
{
    /// <summary>An edit lowered an order's total below what had already been captured.</summary>
    public const string OrderEditRefund = "OrderEditRefund";

    /// <summary>The customer cancelled and chose to be refunded to their wallet.</summary>
    public const string OrderCancellationRefund = "OrderCancellationRefund";

    /// <summary>The wallet portion of an order coming back after that order was cancelled -
    /// this always returns to the wallet regardless of where the rest of the money goes.</summary>
    public const string WalletPortionReturned = "WalletPortionReturned";

    /// <summary>Balance spent paying for an order.</summary>
    public const string OrderPayment = "OrderPayment";

    /// <summary>A top-up that arrived after the changes it was paying for had already been
    /// dropped — the money can't buy what it was for, so it goes back to the customer.</summary>
    public const string UnappliedTopUpReturned = "UnappliedTopUpReturned";

    /// <summary>An admin adjusting a balance by hand, e.g. to settle a dispute.</summary>
    public const string AdminAdjustment = "AdminAdjustment";
}

/// <summary>
/// One movement of wallet balance. The ledger — not <see cref="User.WalletBalance"/> — is the
/// record of what happened: the balance field is a running total kept for cheap reads, while
/// these rows are what a dispute is actually settled against.
/// </summary>
public class WalletTransaction
{
    [BsonId]
    [BsonRepresentation(BsonType.ObjectId)]
    public string? Id { get; set; }

    [BsonElement("userId")]
    public required string UserId { get; set; }

    /// <summary>Signed: positive credits the customer, negative spends their balance.</summary>
    [BsonElement("amount")]
    public decimal Amount { get; set; }

    /// <summary>The balance after this movement, captured at the time so a statement can be
    /// rendered without replaying every prior row.</summary>
    [BsonElement("balanceAfter")]
    public decimal BalanceAfter { get; set; }

    /// <summary>One of <see cref="WalletTransactionReasons"/>.</summary>
    [BsonElement("reason")]
    public required string Reason { get; set; }

    /// <summary>The order this movement relates to, when there is one.</summary>
    [BsonElement("orderId")]
    public string? OrderId { get; set; }

    [BsonElement("createdAt")]
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
}
