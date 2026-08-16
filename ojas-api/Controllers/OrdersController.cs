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
    private readonly IMongoDbService _db;
    private readonly DeliveryChargesService _deliveryChargesService;
    private readonly ProductService _productService;

    public OrdersController(
        OrderService orderService,
        IMongoDbService db,
        DeliveryChargesService deliveryChargesService,
        ProductService productService)
    {
        _orderService = orderService;
        _db = db;
        _deliveryChargesService = deliveryChargesService;
        _productService = productService;
    }

    /// <summary>Net stock change per product between two versions of an order.</summary>
    private static List<(string ProductId, int Quantity, string ProductName)> StockDelta(
        List<OrderItem> before,
        List<OrderItem> after)
    {
        var deltas = new Dictionary<string, (int Quantity, string Name)>();

        foreach (var item in after)
        {
            deltas.TryGetValue(item.ProductId, out var current);
            deltas[item.ProductId] = (current.Quantity + item.Quantity, item.ProductName);
        }

        foreach (var item in before)
        {
            deltas.TryGetValue(item.ProductId, out var current);
            deltas[item.ProductId] = (current.Quantity - item.Quantity, current.Name ?? item.ProductName);
        }

        return deltas
            .Where(kv => kv.Value.Quantity != 0)
            .Select(kv => (kv.Key, kv.Value.Quantity, kv.Value.Name))
            .ToList();
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
            order.DeliveryCharge,
            order.DeliveryDistanceKm,
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

        var itemsTotal = items.Sum(i => i.Price * i.Quantity);

        // Delivery charge is always computed server-side from the warehouse config, never trusted from the client.
        var quote = await _deliveryChargesService.CalculateDeliveryChargeAsync(request.Latitude.Value, request.Longitude.Value);

        // The serviceable-radius check is the authority on where we deliver; the
        // client warns earlier, but an order can only be refused here.
        if (!quote.IsServiceable)
        {
            return BadRequest(new
            {
                message = $"We currently deliver only within {quote.MaxRadiusKm:0.#} km of our store. Your pinned location is about {quote.DistanceKm:0.#} km away.",
                outOfRange = true,
                distanceKm = quote.DistanceKm,
                maxRadiusKm = quote.MaxRadiusKm,
            });
        }

        // Take the stock before creating the order, so a shortfall means no order
        // exists rather than an order we can't fulfil.
        var stock = await _productService.TryConsumeStockAsync(
            items.Select(i => (i.ProductId, i.Quantity, i.ProductName)));

        if (!stock.Success)
        {
            return BadRequest(new
            {
                message = stock.Available > 0
                    ? $"Only {stock.Available} left of {stock.ProductName}. Please reduce the quantity."
                    : $"{stock.ProductName} just went out of stock.",
                outOfStock = true,
                productName = stock.ProductName,
                available = stock.Available,
            });
        }

        var deliveryCharge = quote.Charge;
        var distanceKm = quote.DistanceKm;

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
            DeliveryCharge = deliveryCharge,
            DeliveryDistanceKm = distanceKm,
            TotalAmount = Math.Round(itemsTotal + deliveryCharge, 2, MidpointRounding.AwayFromZero),
        };

        var created = await _orderService.CreateOrderAsync(order);

        return Ok(ToResponse(created));
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

    /// <summary>
    /// Customer edits their own order — items, quantities and delivery details —
    /// while it is still Pending or Confirmed. Totals and delivery are recomputed
    /// server-side, exactly as they are when placing an order.
    /// </summary>
    [HttpPut("my/{orderId}")]
    public async Task<ActionResult<OrderResponse>> UpdateMyOrder(string orderId, [FromBody] UpdateMyOrderRequest request)
    {
        var userId = User.FindFirstValue(ClaimTypes.NameIdentifier);
        if (userId == null) return Unauthorized();

        var order = await _orderService.GetOrderByIdAsync(orderId);
        if (order == null)
            return NotFound(new { message = "Order not found." });

        if (!string.Equals(order.UserId, userId, StringComparison.Ordinal))
            return Forbid();

        if (!OrderService.IsCustomerEditable(order.Status))
            return BadRequest(new
            {
                message = $"This order is already {order.Status.ToLowerInvariant()} and can no longer be changed.",
                notEditable = true,
            });

        if (request.Items == null || request.Items.Count == 0)
            return BadRequest(new { message = "Order must contain at least one item." });

        if (request.Latitude is null || request.Longitude is null)
            return BadRequest(new { message = "Please pin your exact delivery location on the map." });

        var quote = await _deliveryChargesService.CalculateDeliveryChargeAsync(request.Latitude.Value, request.Longitude.Value);
        if (!quote.IsServiceable)
            return BadRequest(new
            {
                message = $"We currently deliver only within {quote.MaxRadiusKm:0.#} km of our store. Your pinned location is about {quote.DistanceKm:0.#} km away.",
                outOfRange = true,
                distanceKm = quote.DistanceKm,
                maxRadiusKm = quote.MaxRadiusKm,
            });

        var items = request.Items.Select(i => new OrderItem
        {
            ProductId = i.ProductId,
            ProductName = i.ProductName,
            Price = i.Price,
            Weight = i.Weight,
            Quantity = i.Quantity,
        }).ToList();

        // Only the net change touches stock: adding 2 to an order that already had 3
        // takes 2 more, dropping to 1 puts 2 back.
        var delta = StockDelta(order.Items, items);
        var increases = delta.Where(d => d.Quantity > 0).ToList();
        var decreases = delta.Where(d => d.Quantity < 0)
            .Select(d => (d.ProductId, -d.Quantity))
            .ToList();

        var stock = await _productService.TryConsumeStockAsync(increases);
        if (!stock.Success)
        {
            return BadRequest(new
            {
                message = stock.Available > 0
                    ? $"Only {stock.Available} left of {stock.ProductName}. Please reduce the quantity."
                    : $"{stock.ProductName} is out of stock.",
                outOfStock = true,
                productName = stock.ProductName,
                available = stock.Available,
            });
        }

        await _productService.RestoreStockAsync(decreases);

        var itemsTotal = items.Sum(i => i.Price * i.Quantity);

        var updated = await _orderService.UpdateOrderContentsAsync(
            orderId,
            items,
            request.FullName,
            request.Phone,
            request.Address,
            request.Latitude.Value,
            request.Longitude.Value,
            UserController.BuildMapLink(request.Latitude.Value, request.Longitude.Value),
            request.Notes ?? string.Empty,
            quote.Charge,
            quote.DistanceKm,
            Math.Round(itemsTotal + quote.Charge, 2, MidpointRounding.AwayFromZero));

        if (!updated)
            return NotFound(new { message = "Order not found." });

        var refreshed = await _orderService.GetOrderByIdAsync(orderId);
        return Ok(ToResponse(refreshed!));
    }

    /// <summary>Customer cancels their own order while it is still Pending or Confirmed.</summary>
    [HttpPatch("my/{orderId}/cancel")]
    public async Task<IActionResult> CancelMyOrder(string orderId)
    {
        var userId = User.FindFirstValue(ClaimTypes.NameIdentifier);
        if (userId == null) return Unauthorized();

        var order = await _orderService.GetOrderByIdAsync(orderId);
        if (order == null)
            return NotFound(new { message = "Order not found." });

        if (!string.Equals(order.UserId, userId, StringComparison.Ordinal))
            return Forbid();

        if (string.Equals(order.Status, "Cancelled", StringComparison.OrdinalIgnoreCase))
            return NoContent();

        if (!OrderService.IsCustomerEditable(order.Status))
            return BadRequest(new
            {
                message = $"This order is already {order.Status.ToLowerInvariant()} and can no longer be cancelled.",
                notEditable = true,
            });

        await _orderService.UpdateOrderStatusAsync(orderId, "Cancelled");
        // Cancelled goods go back on the shelf.
        await _productService.RestoreStockAsync(order.Items.Select(i => (i.ProductId, i.Quantity)));
        return NoContent();
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

        var order = await _orderService.GetOrderByIdAsync(orderId);
        if (order == null)
            return NotFound(new { message = "Order not found." });

        var updated = await _orderService.UpdateOrderStatusAsync(orderId, normalizedStatus);
        if (!updated)
            return NotFound(new { message = "Order not found." });

        // An admin cancelling returns the goods, exactly as a customer cancel does.
        // Guarded on the previous status so re-saving "Cancelled" can't credit twice.
        var wasCancelled = string.Equals(order.Status, "Cancelled", StringComparison.OrdinalIgnoreCase);
        if (normalizedStatus == "Cancelled" && !wasCancelled)
        {
            await _productService.RestoreStockAsync(order.Items.Select(i => (i.ProductId, i.Quantity)));
        }

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
