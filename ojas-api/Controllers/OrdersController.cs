using System.Security.Claims;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using OjasApi.Models;
using OjasApi.Services;

namespace OjasApi.Controllers;

[ApiController]
[Route("api/[controller]")]
[Authorize]
public class OrdersController : ControllerBase
{
    private readonly OrderService _orderService;

    public OrdersController(OrderService orderService)
    {
        _orderService = orderService;
    }

    [HttpPost]
    public async Task<ActionResult<OrderResponse>> PlaceOrder([FromBody] PlaceOrderRequest request)
    {
        var userId = User.FindFirstValue(ClaimTypes.NameIdentifier);

        if (request.Items == null || request.Items.Count == 0)
            return BadRequest(new { message = "Order must contain at least one item." });

        var items = request.Items.Select(i => new OrderItem
        {
            ProductId = i.ProductId,
            ProductName = i.ProductName,
            Price = i.Price,
            Weight = i.Weight,
            Quantity = i.Quantity,
        }).ToList();

        var totalAmount = items.Sum(i => i.Price * i.Quantity);

        var order = new Order
        {
            UserId = userId,
            FullName = request.FullName,
            Phone = request.Phone,
            Address = request.Address,
            Notes = request.Notes ?? string.Empty,
            Items = items,
            TotalAmount = totalAmount,
        };

        var created = await _orderService.CreateOrderAsync(order);

        var response = new OrderResponse(
            created.Id!,
            created.FullName,
            created.Phone,
            created.Address,
            created.Notes,
            created.Items.Select(i => new OrderItemDto(i.ProductId, i.ProductName, i.Price, i.Weight, i.Quantity)).ToList(),
            created.TotalAmount,
            created.Status,
            created.CreatedAt
        );

        return Ok(response);
    }

    [HttpGet("my")]
    public async Task<ActionResult<List<OrderResponse>>> GetMyOrders()
    {
        var userId = User.FindFirstValue(ClaimTypes.NameIdentifier);
        if (userId == null) return Unauthorized();

        var orders = await _orderService.GetOrdersByUserAsync(userId);
        var response = orders.Select(o => new OrderResponse(
            o.Id!,
            o.FullName,
            o.Phone,
            o.Address,
            o.Notes,
            o.Items.Select(i => new OrderItemDto(i.ProductId, i.ProductName, i.Price, i.Weight, i.Quantity)).ToList(),
            o.TotalAmount,
            o.Status,
            o.CreatedAt
        )).ToList();

        return Ok(response);
    }
}
