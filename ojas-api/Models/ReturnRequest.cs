using MongoDB.Bson;
using MongoDB.Bson.Serialization.Attributes;

namespace OjasApi.Models;

/// <summary>
/// Where a return has got to. The names are the customer-facing story, in order, and the flow is
/// the one every large marketplace uses: the customer asks, a human agrees, the goods come back,
/// and only then does the money move.
///
/// The order matters. Refunding before the pack is in our hands would make a return an
/// unverifiable claim, which for food - where the whole condition of the policy is that the seal
/// is unbroken - is the difference between a returns policy and a giveaway.
/// </summary>
public static class ReturnRequestStatuses
{
    /// <summary>The customer has asked. Nothing has been agreed and no money has moved.</summary>
    public const string Requested = "Requested";

    /// <summary>We have agreed to take it back and owe the customer a pickup.</summary>
    public const string Approved = "Approved";

    /// <summary>The pack is back with us and has been checked.</summary>
    public const string PickedUp = "PickedUp";

    /// <summary>Money handed back - to the wallet, or raised against the original payment
    /// method. Terminal.</summary>
    public const string Refunded = "Refunded";

    /// <summary>We are not taking it back, with a reason the customer can read. Terminal.</summary>
    public const string Rejected = "Rejected";

    /// <summary>The customer changed their mind before we collected. Terminal.</summary>
    public const string Cancelled = "Cancelled";

    public static readonly string[] All =
        [Requested, Approved, PickedUp, Refunded, Rejected, Cancelled];

    /// <summary>Still consuming the customer's returnable quantity. A rejected or cancelled
    /// request releases the items it was holding, so the customer can ask again - typically with
    /// a different reason, or after being told what we needed.</summary>
    public static bool IsLive(string status) =>
        status is Requested or Approved or PickedUp or Refunded;

    /// <summary>Nothing further will happen to it.</summary>
    public static bool IsFinished(string status) =>
        status is Refunded or Rejected or Cancelled;

    public static string? Normalize(string? value) =>
        All.FirstOrDefault(s => string.Equals(s, value?.Trim(), StringComparison.OrdinalIgnoreCase));
}

/// <summary>
/// Why the customer is sending it back, as a fixed list rather than free text.
///
/// A code, not a sentence, because these drive decisions on our side: a damaged or wrong-item
/// return is our fault and should be approved on sight. Free text alone could not be counted, and
/// counting these is how the owner finds out that one pack keeps arriving crushed.
/// </summary>
public static class ReturnReasons
{
    public const string Damaged = "Damaged";
    public const string WrongItem = "WrongItem";
    public const string Expired = "Expired";
    public const string QualityNotAsExpected = "QualityNotAsExpected";
    public const string Other = "Other";

    /// <summary>
    /// The reasons a return may be raised for. Note what is NOT here: changing your mind.
    ///
    /// "Ordered by mistake" was offered until the owner removed it on 2026-09-11 - "It's their
    /// fault not ours" - so a change of mind is not a reason we accept for taking food back.
    /// Anything genuinely of that kind now arrives as <see cref="Other"/> with the customer's own
    /// words attached, where a human decides rather than the form having promised anything.
    /// Do not reinstate it without asking.
    /// </summary>
    public static readonly string[] All =
        [Damaged, WrongItem, Expired, QualityNotAsExpected, Other];

    /// <summary>Our mistake, not the customer's. These are worth separating because they should
    /// never be argued with over the seal condition - a pack that arrived crushed or was the
    /// wrong product was never in a state the customer could have kept.</summary>
    public static bool IsOurFault(string reason) =>
        reason is Damaged or WrongItem or Expired;

    public static string? Normalize(string? value) =>
        All.FirstOrDefault(r => string.Equals(r, value?.Trim(), StringComparison.OrdinalIgnoreCase));
}

/// <summary>One line of a return: which product, how many, and what that many are worth back.
/// The money is recorded per line at the moment the request is made, so a later price change on
/// the product cannot alter what an agreed return is worth.</summary>
public class ReturnRequestItem
{
    [BsonElement("productId")]
    public required string ProductId { get; set; }

    [BsonElement("productName")]
    public required string ProductName { get; set; }

    [BsonElement("weight")]
    public required string Weight { get; set; }

    /// <summary>The unit price the order actually charged, not today's price.</summary>
    [BsonElement("price")]
    public decimal Price { get; set; }

    [BsonElement("quantity")]
    public int Quantity { get; set; }

    /// <summary>What these units are worth back: their share of what the customer actually paid,
    /// after the order's discounts. Worked out by <see cref="Services.ReturnPricing"/> and stored
    /// so the figure the customer was shown is the figure that is honoured.</summary>
    [BsonElement("refundAmount")]
    public decimal RefundAmount { get; set; }
}

/// <summary>One step in a return's life, kept as a list so the customer sees a timeline rather
/// than a single status word, and so support can tell who moved it and when.</summary>
public class ReturnRequestEvent
{
    [BsonElement("status")]
    public required string Status { get; set; }

    /// <summary>What was said to the customer at this step, if anything - the rejection reason,
    /// the pickup note. Shown verbatim, so it must never contain internal wording.</summary>
    [BsonElement("note")]
    public string? Note { get; set; }

    /// <summary>"customer" or "admin". Not a user id: this is rendered to the customer, and
    /// "changed by 66f3..." tells them nothing.</summary>
    [BsonElement("by")]
    public required string By { get; set; }

    [BsonElement("at")]
    public DateTime At { get; set; } = DateTime.UtcNow;
}

/// <summary>
/// A customer's request to send part of a delivered order back.
///
/// Its own collection rather than a field on the order, for two reasons. An order can accumulate
/// several returns over its window, so it is a list either way; and the admin queue reads
/// "everything awaiting a human, oldest first" across all orders, which is a query against
/// returns, not a scan of every order ever placed.
///
/// The money is deliberately NOT moved by anything here. Settling a return routes through the
/// same refund machinery a cancellation uses (<see cref="Services.OrderCancellationService"/>),
/// so an order's refunded total, its per-gateway-order refundable balance and the wallet ledger
/// all stay derived from one implementation - the rule that exists because cancellation once had
/// three partial ones.
/// </summary>
public class ReturnRequest
{
    [BsonId]
    [BsonRepresentation(BsonType.ObjectId)]
    public string? Id { get; set; }

    [BsonElement("orderId")]
    public required string OrderId { get; set; }

    /// <summary>The customer who placed the order. Every customer-facing read filters on this;
    /// a return is as sensitive as the order it belongs to.</summary>
    [BsonElement("userId")]
    public required string UserId { get; set; }

    /// <summary>Denormalised so the admin queue can show who and which order without a lookup
    /// per row. Display only - never trusted for a decision.</summary>
    [BsonElement("customerName")]
    public string? CustomerName { get; set; }

    [BsonElement("customerPhone")]
    public string? CustomerPhone { get; set; }

    /// <summary>Where we are collecting from: the order's delivery address, copied at request
    /// time so a later change to the customer's saved addresses cannot redirect a pickup.</summary>
    [BsonElement("pickupAddress")]
    public string? PickupAddress { get; set; }

    [BsonElement("items")]
    public List<ReturnRequestItem> Items { get; set; } = [];

    [BsonElement("reason")]
    public required string Reason { get; set; }

    /// <summary>The customer's own words, optional, capped by the request validator. Kept apart
    /// from <see cref="Reason"/> so the coded reason stays countable.</summary>
    [BsonElement("comment")]
    public string? Comment { get; set; }

    [BsonElement("status")]
    public string Status { get; set; } = ReturnRequestStatuses.Requested;

    /// <summary>Where the money goes once this is settled - the customer's choice, made when they
    /// raise the request, and the same fork a cancellation offers. Wallet is immediate; source
    /// waits for an admin, because a customer action must never move real money on its own.</summary>
    [BsonElement("refundDestination")]
    public string RefundDestination { get; set; } = RefundDestinations.Wallet;

    /// <summary>The sum of the line refunds, fixed when the request is made.</summary>
    [BsonElement("refundAmount")]
    public decimal RefundAmount { get; set; }

    /// <summary>What actually reached the customer's wallet when this was settled.</summary>
    [BsonElement("refundedToWallet")]
    public decimal RefundedToWallet { get; set; }

    /// <summary>What was actually raised against the original payment method.</summary>
    [BsonElement("refundedToSource")]
    public decimal RefundedToSource { get; set; }

    /// <summary>Owed to the original payment method but not yet sent - the gateway refused, or
    /// the order had no captured balance left on that leg. Kept visible rather than dropped, the
    /// same way a cancellation queues what it could not pay out.</summary>
    [BsonElement("refundQueued")]
    public decimal RefundQueued { get; set; }

    [BsonElement("events")]
    public List<ReturnRequestEvent> Events { get; set; } = [];

    [BsonElement("createdAt")]
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;

    [BsonElement("updatedAt")]
    public DateTime? UpdatedAt { get; set; }

    /// <summary>Total units across every line - the figure the admin queue shows at a glance.</summary>
    public int TotalQuantity => Items.Sum(i => i.Quantity);
}
