using System.Linq.Expressions;
using MongoDB.Bson;
using MongoDB.Driver;
using OjasApi.Models;

namespace OjasApi.Services;

/// <summary>
/// Keeps a signed-in customer's cart and checkout selection on the server, so the same basket is
/// there on every device they sign in from. See <see cref="Cart"/> for why it moved off the
/// browser.
///
/// Deliberately not a pricing authority. Orders are still priced from the catalogue by
/// <see cref="OrderPricing"/> when they are placed; this only remembers what the customer picked.
/// </summary>
public class CartService(IMongoDbService db, ProductService products)
{
    /// <summary>One line per product, and the whole catalogue is a few dozen products. A list
    /// longer than this is not a basket, and refusing it keeps one account from growing an
    /// unbounded document.</summary>
    public const int MaxLines = 100;

    /// <summary>The same ceiling the order endpoint enforces on a single line
    /// (OrdersController.MaxQuantityPerLine), so the cart can never hold a quantity checkout
    /// would then refuse.</summary>
    public const int MaxQuantityPerLine = 100;

    /// <summary>
    /// The customer's two lists with each line's current product attached.
    ///
    /// A line whose product has since been deleted or unlisted is left out rather than returned
    /// half-empty: an unlisted product is one the owner has taken off sale, and showing it in a
    /// basket would invite a checkout that the order endpoint then refuses. It stays in the stored
    /// document, so relisting the product brings it back.
    /// </summary>
    public async Task<CartResponse> GetAsync(string userId)
    {
        var cart = await db.Carts.Find(c => c.UserId == userId).FirstOrDefaultAsync();
        if (cart == null)
            return new CartResponse([], [], null);

        var catalogue = await products.GetByIdsAsync(
            cart.Items.Concat(cart.CheckoutItems).Select(line => line.ProductId));

        return new CartResponse(
            Hydrate(cart.Items, catalogue),
            Hydrate(cart.CheckoutItems, catalogue),
            cart.UpdatedAt);
    }

    /// <summary>Replaces one of the two lists with exactly what the client now holds, leaving the
    /// other untouched. The two lists are written separately so that a cart edit on one device and
    /// a checkout edit on another can never overwrite each other.</summary>
    public async Task ReplaceAsync(string userId, CartList list, IEnumerable<CartLineRequest> lines)
    {
        Expression<Func<Cart, List<CartLine>>> field = list == CartList.Cart
            ? c => c.Items
            : c => c.CheckoutItems;

        await db.Carts.UpdateOneAsync(
            c => c.UserId == userId,
            Builders<Cart>.Update
                .Set(field, Normalize(lines))
                .Set(c => c.UpdatedAt, DateTime.UtcNow),
            new UpdateOptions { IsUpsert = true });
    }

    /// <summary>
    /// Makes a client's list safe to store: malformed product ids and non-positive quantities are
    /// dropped, quantities are capped at <see cref="MaxQuantityPerLine"/>, and a product that
    /// appears twice keeps its last quantity. Capping rather than refusing, because a customer
    /// who pressed + too many times on an untracked product should keep their basket, not lose
    /// the whole save over one line.
    /// </summary>
    internal static List<CartLine> Normalize(IEnumerable<CartLineRequest> lines)
    {
        var normalized = new List<CartLine>();

        foreach (var line in lines)
        {
            if (line == null || line.Quantity < 1 || !ObjectId.TryParse(line.ProductId, out _))
                continue;

            var quantity = Math.Min(line.Quantity, MaxQuantityPerLine);
            var existing = normalized.Find(l => l.ProductId == line.ProductId);
            if (existing != null)
                existing.Quantity = quantity;
            else
                normalized.Add(new CartLine { ProductId = line.ProductId, Quantity = quantity });
        }

        return normalized;
    }

    private static List<CartLineResponse> Hydrate(List<CartLine> lines, Dictionary<string, Product> catalogue) =>
        lines
            .Where(line => catalogue.TryGetValue(line.ProductId, out var product) && product.IsListed != false)
            .Select(line => new CartLineResponse(catalogue[line.ProductId], line.Quantity))
            .ToList();
}
