using MongoDB.Driver;
using OjasApi.Models;

namespace OjasApi.Services;

public class OrderService(MongoDbService db)
{
    private readonly IMongoCollection<Order> _orders = db.Orders;

    public async Task<Order> CreateOrderAsync(Order order)
    {
        await _orders.InsertOneAsync(order);
        return order;
    }

    public async Task<List<Order>> GetOrdersByUserAsync(string userId)
    {
        return await _orders.Find(o => o.UserId == userId).SortByDescending(o => o.CreatedAt).ToListAsync();
    }
}
