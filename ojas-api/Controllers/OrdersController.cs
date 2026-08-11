using System.Security.Claims;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using MongoDB.Driver;
using OjasApi.Models;
using OjasApi.Services;

namespace OjasApi.Controllers;

[ApiController]
[Route("api/[controller]")]
[Authorize]
public class OrdersController : ControllerBase
{
    private readonly OrderService _orderService;
    private readonly MongoDbService _db;

    public OrdersController(OrderService orderService, MongoDbService db)
    {
        _orderService = orderService;
        _db = db;
    }

    private static OrderResponse ToResponse(Order order)
    {
        return new OrderResponse(
            order.Id!,
            order.FullName,
            order.Phone,
            order.Address,
            order.Latitude,
            order.Longitude,
            order.AddressMapLink,
            order.Notes,
            order.Items.Select(i => new OrderItemDto(i.ProductId, i.ProductName, i.Price, i.Weight, i.Quantity)).ToList(),
            order.TotalAmount,
            order.Status,
            order.CreatedAt,
            order.DeliveryPartnerId,
            order.DeliveryPartnerName,
            order.UpdatedAt
        );
    }

    [HttpPost]
    public async Task<ActionResult<OrderResponse>> PlaceOrder([FromBody] PlaceOrderRequest request)
    {
        var userId = User.FindFirstValue(ClaimTypes.NameIdentifier);

        if (request.Items == null || request.Items.Count == 0)
            return BadRequest(new { message = "Order must contain at least one item." });

        if (request.Latitude is null || request.Longitude is null)
            return BadRequest(new { message = "Please pin your exact delivery location on the map." });

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
            Latitude = request.Latitude.Value,
            Longitude = request.Longitude.Value,
            AddressMapLink = UserController.BuildMapLink(request.Latitude.Value, request.Longitude.Value),
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
            created.Latitude,
            created.Longitude,
            created.AddressMapLink,
            created.Notes,
            created.Items.Select(i => new OrderItemDto(i.ProductId, i.ProductName, i.Price, i.Weight, i.Quantity)).ToList(),
            created.TotalAmount,
            created.Status,
            created.CreatedAt,
            created.DeliveryPartnerId,
            created.DeliveryPartnerName,
            created.UpdatedAt
        );

        return Ok(response);
    }

    [HttpGet("my")]
    public async Task<ActionResult<List<OrderResponse>>> GetMyOrders()
    {
        var userId = User.FindFirstValue(ClaimTypes.NameIdentifier);
        if (userId == null) return Unauthorized();

        var orders = await _orderService.GetOrdersByUserAsync(userId);
        var response = orders.Select(ToResponse).ToList();

        return Ok(response);
    }

    [HttpGet("admin/all")]
    [Authorize(Roles = UserRoles.Admin)]
    public async Task<ActionResult<List<OrderResponse>>> GetAllOrdersForAdmin()
    {
        var orders = await _orderService.GetAllOrdersAsync();
        return Ok(orders.Select(ToResponse).ToList());
    }

    [HttpGet("delivery/my")]
    [Authorize(Roles = UserRoles.Delivery)]
    public async Task<ActionResult<List<OrderResponse>>> GetAssignedOrdersForDelivery()
    {
        var deliveryPartnerId = User.FindFirstValue(ClaimTypes.NameIdentifier);
        if (deliveryPartnerId == null) return Unauthorized();

        var orders = await _orderService.GetOrdersAssignedToDeliveryAsync(deliveryPartnerId);
        return Ok(orders.Select(ToResponse).ToList());
    }

    [HttpGet("admin/delivery-partners")]
    [Authorize(Roles = UserRoles.Admin)]
    public async Task<ActionResult<List<StaffUserResponse>>> GetDeliveryPartners()
    {
        var users = await _db.Users
            .Find(u => u.Role == UserRoles.Delivery)
            .SortBy(u => u.FullName)
            .ToListAsync();

        return Ok(users.Select(u => new StaffUserResponse(u.Id!, u.FullName, u.Email, u.Phone, u.Role)).ToList());
    }

    [HttpPatch("admin/{orderId}/status")]
    [Authorize(Roles = UserRoles.Admin)]
    public async Task<IActionResult> UpdateOrderStatusAsAdmin(string orderId, [FromBody] UpdateOrderStatusRequest request)
    {
        var normalizedStatus = OrderService.NormalizeStatus(request.Status);
        if (normalizedStatus == null)
            return BadRequest(new { message = "Invalid status value." });

        var updated = await _orderService.UpdateOrderStatusAsync(orderId, normalizedStatus);
        if (!updated)
            return NotFound(new { message = "Order not found." });

        return NoContent();
    }

    [HttpPatch("admin/{orderId}/assign")]
    [Authorize(Roles = UserRoles.Admin)]
    public async Task<IActionResult> AssignDeliveryPartner(string orderId, [FromBody] AssignDeliveryPartnerRequest request)
    {
        var deliveryPartner = await _db.Users
            .Find(u => u.Id == request.DeliveryPartnerId && u.Role == UserRoles.Delivery)
            .FirstOrDefaultAsync();

        if (deliveryPartner == null)
            return BadRequest(new { message = "Invalid delivery partner." });

        var updated = await _orderService.AssignDeliveryPartnerAsync(orderId, deliveryPartner.Id!, deliveryPartner.FullName);
        if (!updated)
            return NotFound(new { message = "Order not found." });

        return NoContent();
    }

    [HttpPatch("delivery/{orderId}/delivered")]
    [Authorize(Roles = UserRoles.Delivery)]
    public async Task<IActionResult> MarkDeliveredByDeliveryPartner(string orderId)
    {
        var deliveryPartnerId = User.FindFirstValue(ClaimTypes.NameIdentifier);
        if (deliveryPartnerId == null) return Unauthorized();

        var order = await _orderService.GetOrderByIdAsync(orderId);
        if (order == null)
            return NotFound(new { message = "Order not found." });

        if (!string.Equals(order.DeliveryPartnerId, deliveryPartnerId, StringComparison.Ordinal))
            return Forbid();

        if (string.Equals(order.Status, "Delivered", StringComparison.OrdinalIgnoreCase))
            return NoContent();

        var updated = await _orderService.UpdateOrderStatusAsync(orderId, "Delivered");
        if (!updated)
            return NotFound(new { message = "Order not found." });

        return NoContent();
    }
}
