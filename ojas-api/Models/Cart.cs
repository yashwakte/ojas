using MongoDB.Bson.Serialization.Attributes;

namespace OjasApi.Models;

/// <summary>
/// A signed-in customer's basket, held on the server so it follows the account rather than the
/// browser. It used to live only in localStorage, so a customer who filled a cart on their phone
/// and signed in on a laptop found it empty - which to them reads as the shop having lost it.
///
/// One document per account, keyed by the user id, holding the two lists the storefront keeps:
/// the cart itself, and the lines chosen for checkout ("Buy Now", or the cart's "Checkout
/// selected"). Only product ids and quantities are stored. Names, prices and pictures are read
/// fresh from the catalogue on every fetch, so a price the owner changes is the price a returning
/// customer sees, never a copy frozen at the moment they added the item.
///
/// Tolerates fields it does not know, like <see cref="Product"/>: a field added to carts later
/// must not make every cart unreadable to an older build after a rollback.
/// </summary>
[BsonIgnoreExtraElements]
public class Cart
{
    [BsonId]
    public required string UserId { get; set; }

    [BsonElement("items")]
    public List<CartLine> Items { get; set; } = [];

    [BsonElement("checkoutItems")]
    public List<CartLine> CheckoutItems { get; set; } = [];

    [BsonElement("updatedAt")]
    public DateTime UpdatedAt { get; set; } = DateTime.UtcNow;
}

[BsonIgnoreExtraElements]
public class CartLine
{
    [BsonElement("productId")]
    public required string ProductId { get; set; }

    [BsonElement("quantity")]
    public int Quantity { get; set; }
}

/// <summary>Which of the account's two lists a write replaces.</summary>
public enum CartList
{
    Cart,
    Checkout,
}

public record CartLineRequest(string ProductId, int Quantity);

/// <summary>The whole list, not a delta: the client sends what it now holds and the server keeps
/// exactly that. A replay of the same request is harmless, and there is no sequence of partial
/// updates for two devices to interleave into something neither of them had.</summary>
public record ReplaceCartLinesRequest(List<CartLineRequest> Items);

public record CartLineResponse(Product Product, int Quantity);

public record CartResponse(List<CartLineResponse> Items, List<CartLineResponse> CheckoutItems, DateTime? UpdatedAt);
