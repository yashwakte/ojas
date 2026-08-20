using MongoDB.Driver;
using OjasApi.Models;

namespace OjasApi.Services;

public class OrderService(IMongoDbService db)
{
    private readonly IMongoCollection<Order> _orders = db.Orders;

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

    public static readonly HashSet<string> AllowedPaymentStatuses = ["Pending", "Collected"];

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

    public async Task<List<Order>> GetOrdersByUserAsync(string userId)
    {
        return await _orders.Find(o => o.UserId == userId).SortByDescending(o => o.CreatedAt).ToListAsync();
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
