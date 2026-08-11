using MongoDB.Driver;
using OjasApi.Models;

namespace OjasApi.Services;

public class OrderService(MongoDbService db)
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

    public async Task<Order> CreateOrderAsync(Order order)
    {
        await _orders.InsertOneAsync(order);
        return order;
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
