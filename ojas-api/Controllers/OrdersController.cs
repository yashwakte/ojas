using System.Security.Claims;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.RateLimiting;
using MongoDB.Driver;
using OjasApi.Models;
using OjasApi.Services;

namespace OjasApi.Controllers;

[ApiController]
[Route("api/[controller]")]
[Authorize]
[EnableRateLimiting("general")]
public class OrdersController : ControllerBase
{
    private readonly OrderService _orderService;
    private readonly IMongoDbService _db;
    private readonly DeliveryChargesService _deliveryChargesService;
    private readonly ProductService _productService;
    private readonly CashfreeService _cashfreeService;
    private readonly WalletService _walletService;
    private readonly OrderPaymentOutcomeService _paymentOutcome;
    private readonly OrderCancellationService _cancellation;
    private readonly ILogger<OrdersController> _logger;

    // Cash on Delivery was retired - every new order is paid online. Orders already stored with
    // "COD" still render and can still be marked collected, but none can be created.
    private const string OnlinePaymentMethod = OrderService.OnlinePaymentMethod;

    /// <summary>An order whose wallet balance covered the entire total never reaches the gateway.</summary>
    private const string WalletPaymentMethod = OrderService.WalletPaymentMethod;

    public OrdersController(
        OrderService orderService,
        IMongoDbService db,
        DeliveryChargesService deliveryChargesService,
        ProductService productService,
        CashfreeService cashfreeService,
        WalletService walletService,
        OrderPaymentOutcomeService paymentOutcome,
        OrderCancellationService cancellation,
        ILogger<OrdersController> logger)
    {
        _orderService = orderService;
        _db = db;
        _deliveryChargesService = deliveryChargesService;
        _productService = productService;
        _cashfreeService = cashfreeService;
        _walletService = walletService;
        _paymentOutcome = paymentOutcome;
        _cancellation = cancellation;
        _logger = logger;
    }

    /// <summary>Why an address was refused. Priced by pincode the message names the pincode,
    /// because that is what the customer can actually correct; on the older distance rules it
    /// names the radius, which is what applied then.</summary>
    private static object OutOfAreaPayload(DeliveryQuote quote) => quote.PricedByPincode
        ? new
        {
            message = "We don't deliver to that pincode yet. Please check the pincode in your address.",
            outOfRange = true,
            distanceKm = quote.DistanceKm,
            maxRadiusKm = quote.MaxRadiusKm,
        }
        : new
        {
            message = $"We currently deliver only within {quote.MaxRadiusKm:0.#} km of our store. Your pinned location is about {quote.DistanceKm:0.#} km away.",
            outOfRange = true,
            distanceKm = quote.DistanceKm,
            maxRadiusKm = quote.MaxRadiusKm,
        };

    /// <summary>An upper bound on a single line. Untracked products have no stock to run out,
    /// so without this one request could claim an unbounded quantity of them.</summary>
    private const int MaxQuantityPerLine = 100;

    /// <summary>Guards against a request carrying an absurd number of distinct lines, which would
    /// otherwise be one enormous document and one enormous catalog query.</summary>
    private const int MaxLinesPerOrder = 60;

    /// <summary>Existing order lines keyed by product, tolerating orders written before duplicate
    /// lines were merged — those would otherwise throw on a duplicate key and make the order
    /// permanently un-editable.</summary>
    private static Dictionary<string, OrderItem> ExistingLinesOf(Order order) =>
        order.Items
            .GroupBy(i => i.ProductId, StringComparer.Ordinal)
            .ToDictionary(g => g.Key, g => g.First(), StringComparer.Ordinal);

    /// <summary>
    /// Refuses an edit that takes anything away: a line dropped entirely, or a quantity cut below
    /// what the order already holds. Returns null when the edit only adds.
    /// </summary>
    private BadRequestObjectResult? RejectReductions(
        List<OrderItem> current,
        List<OrderItemDto> requested)
    {
        var requestedQuantities = requested
            .GroupBy(i => i.ProductId, StringComparer.Ordinal)
            .ToDictionary(g => g.Key, g => g.Sum(i => i.Quantity), StringComparer.Ordinal);

        foreach (var line in current)
        {
            requestedQuantities.TryGetValue(line.ProductId, out var wanted);
            if (wanted >= line.Quantity)
                continue;

            return BadRequest(new
            {
                message = wanted == 0
                    ? $"{line.ProductName} can't be removed from an order that's already placed. Cancel the order instead if you no longer want it."
                    : $"The quantity of {line.ProductName} can't be reduced once the order is placed. Cancel the order instead if you no longer want it.",
                reductionNotAllowed = true,
                productName = line.ProductName,
            });
        }

        return null;
    }

    /// <summary>
    /// Turns what the browser asked for into priced order lines, with the catalog as the sole
    /// authority on price. The prices in the request are ignored outright: they used to be
    /// trusted and totalled, which meant a crafted POST could buy anything for any amount.
    /// Name and weight come from the catalog too, so an order can't be made to describe itself
    /// as something it isn't.
    ///
    /// <paramref name="existingLines"/> is passed when editing an order. Lines already on it keep
    /// the price that order agreed, so a catalog price that has moved since doesn't quietly
    /// re-bill the customer for goods they already bought — only genuinely new lines are priced
    /// at today's rate. It also means an order containing a since-deleted product can still be
    /// edited rather than being stuck.
    /// </summary>
    private async Task<(List<OrderItem>? Items, ActionResult? Error)> PriceItemsAsync(
        List<OrderItemDto> requested,
        IReadOnlyDictionary<string, OrderItem>? existingLines = null)
    {
        var catalog = await _productService.GetByIdsAsync(requested.Select(i => i.ProductId));
        var items = new List<OrderItem>();

        // One line per product, quantities added together. Nothing stops a crafted request
        // sending the same product several times over, and storing that verbatim produced an
        // order that could never be edited again - pricing an edit keys the existing lines by
        // product id, and a duplicate key throws.
        var merged = requested
            .GroupBy(i => i.ProductId, StringComparer.Ordinal)
            .Select(g => g.First() with { Quantity = g.Sum(i => i.Quantity) })
            .ToList();

        foreach (var line in merged)
        {
            if (line.Quantity <= 0)
                return (null, BadRequest(new { message = "Every item needs a quantity of at least one." }));

            if (line.Quantity > MaxQuantityPerLine)
            {
                return (null, BadRequest(new
                {
                    message = $"You can order at most {MaxQuantityPerLine} of any one item.",
                }));
            }

            if (catalog.TryGetValue(line.ProductId, out var product))
            {
                // Already bought at an agreed price - keep it, and only take the quantity.
                var agreedPrice = existingLines is not null &&
                    existingLines.TryGetValue(line.ProductId, out var existing)
                    ? existing.Price
                    : ProductService.EffectivePrice(product);

                items.Add(new OrderItem
                {
                    ProductId = product.Id!,
                    ProductName = product.Name,
                    Price = agreedPrice,
                    Weight = product.Weight,
                    Quantity = line.Quantity,
                });
                continue;
            }

            // Not in the catalog. Fine only if this order already has that line, which is how an
            // order survives a product being withdrawn after it was placed.
            if (existingLines is not null && existingLines.TryGetValue(line.ProductId, out var kept))
            {
                items.Add(new OrderItem
                {
                    ProductId = kept.ProductId,
                    ProductName = kept.ProductName,
                    Price = kept.Price,
                    Weight = kept.Weight,
                    Quantity = line.Quantity,
                });
                continue;
            }

            return (null, BadRequest(new
            {
                message = $"{line.ProductName} is no longer available. Please remove it and try again.",
                unknownProduct = true,
                productId = line.ProductId,
            }));
        }

        return (items, null);
    }

    [HttpPost]
    public async Task<ActionResult<OrderResponse>> PlaceOrder([FromBody] PlaceOrderRequest request)
    {
        var userId = User.FindFirstValue(ClaimTypes.NameIdentifier);

        if (!_cashfreeService.IsConfigured)
            return StatusCode(StatusCodes.Status503ServiceUnavailable, new { message = "Online payment is temporarily unavailable. Please try again shortly." });

        if (request.Items == null || request.Items.Count == 0)
            return BadRequest(new { message = "Order must contain at least one item." });

        if (request.Items.Count > MaxLinesPerOrder)
            return BadRequest(new { message = $"An order can hold at most {MaxLinesPerOrder} different items." });

        if (request.Latitude is null || request.Longitude is null)
            return BadRequest(new { message = "Please pin your exact delivery location on the map." });

        if (request.Latitude == 0 && request.Longitude == 0)
            return BadRequest(new { message = "That saved address has an unset location pin. Please edit it and drop a pin on the map before ordering." });

        var (items, pricingError) = await PriceItemsAsync(request.Items);
        if (pricingError != null) return pricingError;

        var itemsTotal = items!.Sum(i => i.Price * i.Quantity);
        var (discountPercentage, discountAmount, appliedCouponCode) = OrderPricing.ApplyCoupon(request.CouponCode, itemsTotal);

        // Delivery charge is always computed server-side from the warehouse config, never trusted from the client.
        // The pincode is read out of the address the customer typed, server-side. Once serviceable
        // pincodes are configured it is what decides both whether we deliver there and what it
        // costs — the map pin no longer affects either, because the browser supplies it and a
        // crafted request can claim to be standing in the warehouse.
        var quote = await _deliveryChargesService.CalculateDeliveryChargeAsync(
            request.Latitude.Value,
            request.Longitude.Value,
            DeliveryChargesService.PincodeFrom(request.Address));

        // This is the authority on where we deliver; the client warns earlier, but an order can
        // only be refused here.
        if (!quote.IsServiceable)
            return BadRequest(OutOfAreaPayload(quote));

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

        // A cart above the free-delivery threshold waives the distance-based charge entirely,
        // independent of the discount tiers above.
        var deliveryCharge = OrderPricing.QualifiesForFreeDelivery(itemsTotal) ? 0m : quote.Charge;
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
            Subtotal = itemsTotal,
            CouponCode = appliedCouponCode,
            DiscountPercentage = discountPercentage,
            DiscountAmount = discountAmount,
            DeliveryCharge = deliveryCharge,
            DeliveryDistanceKm = distanceKm,
            TotalAmount = Math.Round(itemsTotal - discountAmount + deliveryCharge, 2, MidpointRounding.AwayFromZero),
            PaymentMethod = OnlinePaymentMethod,
        };

        var created = await _orderService.CreateOrderAsync(order);

        // Wallet credit is spent first, so the gateway is only asked for the remainder. Debited
        // after the order exists so the ledger row can name it, and atomically, so two orders
        // placed at once can't both spend the same balance - the loser simply gets nothing
        // applied and is charged the full amount at the gateway.
        var walletApplied = 0m;
        if (request.UseWallet && userId != null)
        {
            var balance = await _walletService.GetBalanceAsync(userId);
            var applicable = WalletService.ApplicableAmount(balance, created.TotalAmount);
            if (applicable > 0 && await _walletService.TryDebitAsync(
                    userId, applicable, WalletTransactionReasons.OrderPayment, created.Id))
            {
                walletApplied = applicable;
            }
        }

        var amountDueAtGateway = Math.Round(created.TotalAmount - walletApplied, 2, MidpointRounding.AwayFromZero);
        // Wallet covering the whole thing means there is no gateway payment to make at all.
        var fullyPaidByWallet = amountDueAtGateway <= 0;

        if (walletApplied > 0)
        {
            created.WalletAmountApplied = walletApplied;
            created.AmountPaid = walletApplied;
            if (fullyPaidByWallet)
            {
                created.PaymentMethod = WalletPaymentMethod;
                created.PaymentStatus = "Paid";
            }
            await _orderService.ApplyWalletPaymentAsync(
                created.Id!, walletApplied, created.PaymentMethod, created.PaymentStatus);
        }

        if (fullyPaidByWallet)
        {
            await RetireReplacedOrderAsync(request.RetryOfOrderId, created.Id!, userId);
            return Ok(created.ToResponse());
        }

        try
        {
            var session = await _cashfreeService.CreateOrderAsync(created, amountDueAtGateway);
            await _orderService.SetPaymentSessionAsync(created.Id!, session.PaymentSessionId);
            // Recorded so a later status check knows which gateway order to ask about.
            await _orderService.AddPaymentAttemptAsync(created.Id!, created.Id!, amountDueAtGateway);
            created.PaymentSessionId = session.PaymentSessionId;
        }
        catch (Exception ex)
        {
            // We already took stock, spent wallet credit and created our own order record - roll
            // all three back rather than leaving a stuck order the customer can never pay for.
            await _productService.RestoreStockAsync(items.Select(i => (i.ProductId, i.Quantity)));
            if (walletApplied > 0)
            {
                await _walletService.CreditAsync(
                    userId!, walletApplied, WalletTransactionReasons.OrderCancellationRefund, created.Id);
            }
            await _orderService.UpdateOrderStatusAsync(created.Id!, "Cancelled");
            _logger.LogError(ex, "Cashfree order creation failed for order {OrderId}", created.Id);
            return StatusCode(StatusCodes.Status502BadGateway, new { message = "We couldn't start the payment. Please try again." });
        }

        // Only now that the replacement exists and is payable does the attempt it replaces drop
        // out of the customer's list - a placement that fell over above leaves it visible, since
        // it is still the only order they have.
        await RetireReplacedOrderAsync(request.RetryOfOrderId, created.Id!, userId);

        return Ok(created.ToResponse());
    }

    /// <summary>Retires the failed attempt a retry was placed for. Silent when there was no
    /// retry, and the service refuses anything that isn't this customer's own failed order.</summary>
    private async Task RetireReplacedOrderAsync(string? retryOfOrderId, string replacementOrderId, string? userId)
    {
        if (string.IsNullOrWhiteSpace(retryOfOrderId) || userId == null)
            return;

        if (await _orderService.MarkReplacedByAsync(retryOfOrderId, replacementOrderId, userId))
        {
            _logger.LogInformation(
                "Order {ReplacementOrderId} replaces failed order {FailedOrderId}, which is now hidden from the customer.",
                replacementOrderId, retryOfOrderId);
        }
    }

    [HttpGet("my")]
    public async Task<ActionResult<List<OrderResponse>>> GetMyOrders()
    {
        var userId = User.FindFirstValue(ClaimTypes.NameIdentifier);
        if (userId == null) return Unauthorized();

        var orders = await _orderService.GetOrdersByUserAsync(userId);

        // An edit the customer never paid for stops holding stock (and stops being offered) once
        // it times out. Swept here rather than by a background job: these orders have just been
        // read, and a customer who never edits has nothing to sweep.
        if (await _paymentOutcome.DiscardExpiredAsync(orders))
            orders = await _orderService.GetOrdersByUserAsync(userId);

        return Ok(orders.Select(OrderMapping.ToResponse).ToList());
    }

    /// <summary>
    /// Customer edits their own order — items, quantities and delivery details —
    /// while it is still Pending or Confirmed. Totals and delivery are recomputed
    /// server-side, exactly as they are when placing an order.
    ///
    /// An edit that costs <em>more</em> than the order already holds is not applied here. It is
    /// parked as a pending amendment and only becomes real once the difference is paid, because
    /// applying it first left a customer who backed out of the payment page staring at an order
    /// they hadn't paid for and being asked for money they'd never agreed to spend.
    /// </summary>
    [HttpPut("my/{orderId}")]
    public async Task<ActionResult<UpdateMyOrderResponse>> UpdateMyOrder(string orderId, [FromBody] UpdateMyOrderRequest request)
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

        if (request.Items.Count > MaxLinesPerOrder)
            return BadRequest(new { message = $"An order can hold at most {MaxLinesPerOrder} different items." });

        if (request.Latitude is null || request.Longitude is null)
            return BadRequest(new { message = "Please pin your exact delivery location on the map." });

        if (request.Latitude == 0 && request.Longitude == 0)
            return BadRequest(new { message = "That saved address has an unset location pin. Please edit it and drop a pin on the map before ordering." });

        // Editing only ever adds. A customer can top an order up and pay the difference, but
        // cannot take things off it or cut a quantity — that path meant an edit could owe money
        // *back*, which dragged refunds, wallet credits and stock returns into what should be a
        // one-way flow. Enforced here rather than only by hiding the buttons: the endpoint is the
        // authority on what an edit may do.
        var removalError = RejectReductions(order.Items, request.Items);
        if (removalError != null) return removalError;

        // A previous unpaid edit is superseded by this one. Dropped first so the stock it was
        // holding is released before this edit's own reservation is measured against the order.
        if (order.PendingAmendment != null)
        {
            await _paymentOutcome.DiscardAsync(orderId);
            order = (await _orderService.GetOrderByIdAsync(orderId))!;
        }

        var quote = await _deliveryChargesService.CalculateDeliveryChargeAsync(
            request.Latitude.Value,
            request.Longitude.Value,
            DeliveryChargesService.PincodeFrom(request.Address));
        if (!quote.IsServiceable)
            return BadRequest(OutOfAreaPayload(quote));

        var (items, pricingError) = await PriceItemsAsync(request.Items, ExistingLinesOf(order));
        if (pricingError != null) return pricingError;

        var itemsTotal = items!.Sum(i => i.Price * i.Quantity);

        // Falling back to the order's own coupon means an edit can never silently drop a discount
        // the customer already had. Re-validating it against the new subtotal is the point: a
        // coupon whose minimum cart value is no longer met has to fall away, and the customer is
        // told rather than left to spot the total moving on its own.
        var requestedCoupon = string.IsNullOrWhiteSpace(request.CouponCode) ? order.CouponCode : request.CouponCode;
        var (discountPercentage, discountAmount, appliedCouponCode) = OrderPricing.ApplyCoupon(requestedCoupon, itemsTotal);
        var removedCouponCode = !string.IsNullOrWhiteSpace(requestedCoupon) && appliedCouponCode == null
            ? requestedCoupon
            : null;

        // Re-evaluated against the new subtotal, so an edit that drops the cart back under the
        // free-delivery threshold starts being charged for delivery again.
        var deliveryCharge = OrderPricing.QualifiesForFreeDelivery(itemsTotal) ? 0m : quote.Charge;
        var newTotal = Math.Round(itemsTotal - discountAmount + deliveryCharge, 2, MidpointRounding.AwayFromZero);
        // Settled, not received. A customer who used an offer on Cashfree's own payment page was
        // charged less than the order was raised for and owes nothing further on it - measuring
        // the edit against the money that actually arrived demanded the discount back from them,
        // as a "you'll pay ₹200 more" on an order they had already paid in full.
        var settled = order.SettledAmount;
        var outstanding = Math.Round(newTotal - settled, 2, MidpointRounding.AwayFromZero);

        // Only the net change touches stock: adding 2 to an order that already had 3
        // takes 2 more, dropping to 1 puts 2 back.
        var delta = OrderService.StockDelta(order.Items, items);
        var increases = delta.Where(d => d.Quantity > 0).ToList();
        var decreases = delta.Where(d => d.Quantity < 0)
            .Select(d => (d.ProductId, -d.Quantity))
            .ToList();

        // Taken up front either way, so nobody can pay for something that sold out while they
        // were on the payment page.
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

        // With COD retired there is no cash path to settle a shortfall, so a raised total is
        // collected online. Cashfree can't amend an existing order's amount, so the difference is
        // charged as its own payment against a suffixed order id — and the edit itself waits: the
        // order keeps describing what the customer has actually paid for until that money lands.
        if (settled > 0 && outstanding > 0)
        {
            var topUpOrderId = CashfreeService.TopUpOrderId(orderId);
            CashfreeOrderResult session;
            try
            {
                session = await _cashfreeService.CreateOrderAsync(order, outstanding, topUpOrderId);
            }
            catch (Exception ex)
            {
                // Nothing has been written to the order, so releasing the reservation is the
                // whole rollback.
                await _productService.RestoreStockAsync(increases.Select(i => (i.ProductId, i.Quantity)));
                _logger.LogError(ex, "Cashfree top-up creation failed for order {OrderId}", orderId);
                return StatusCode(StatusCodes.Status502BadGateway, new
                {
                    message = "We couldn't start the payment for the extra amount. Your order is unchanged - please try again.",
                });
            }

            // Without this the top-up is invisible to every later status check: it lives
            // under its own gateway order id, not the one the order started with.
            await _orderService.AddPaymentAttemptAsync(orderId, topUpOrderId, outstanding);

            await _orderService.SetPendingAmendmentAsync(orderId, new OrderAmendment
            {
                Items = items,
                FullName = request.FullName,
                Phone = request.Phone,
                Address = request.Address,
                Latitude = request.Latitude.Value,
                Longitude = request.Longitude.Value,
                AddressMapLink = UserController.BuildMapLink(request.Latitude.Value, request.Longitude.Value),
                Notes = request.Notes ?? string.Empty,
                Subtotal = itemsTotal,
                CouponCode = appliedCouponCode,
                DiscountPercentage = discountPercentage,
                DiscountAmount = discountAmount,
                DeliveryCharge = deliveryCharge,
                DeliveryDistanceKm = quote.DistanceKm,
                TotalAmount = newTotal,
                TopUpAmount = outstanding,
                CashfreeOrderId = topUpOrderId,
                PaymentSessionId = session.PaymentSessionId,
                ExpiresAt = DateTime.UtcNow.Add(OrderService.AmendmentLifetime),
            });

            var staged = await _orderService.GetOrderByIdAsync(orderId);
            return Ok(new UpdateMyOrderResponse(
                staged!.ToResponse(), outstanding, session.PaymentSessionId, null, removedCouponCode,
                PendingPayment: true));
        }

        // Costs no more than the order already holds, so there is nothing to collect and the
        // change takes effect immediately.
        await _productService.RestoreStockAsync(decreases);

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
            itemsTotal,
            appliedCouponCode,
            discountPercentage,
            discountAmount,
            deliveryCharge,
            quote.DistanceKm,
            newTotal);

        if (!updated)
            return NotFound(new { message = "Order not found." });

        // An overpayment goes straight to wallet credit. No admin gate is needed because nothing
        // leaves the business - and a customer who wants the money back on their card instead is
        // told they can cancel and reorder, which is the path that offers that choice.
        decimal? refundAmount = null;
        // Capped at money we actually received: a gateway offer settles the order without any
        // cash changing hands, so it can never be handed back as wallet credit.
        var refundable = Math.Min(-outstanding, order.AmountPaid);
        if (order.AmountPaid > 0 && outstanding < 0 && refundable > 0)
        {
            refundAmount = refundable;
            await _walletService.CreditAsync(
                userId, refundAmount.Value, WalletTransactionReasons.OrderEditRefund, orderId);
            // Recorded as money handed back rather than by rewriting what was captured, so the
            // order still shows what it took and what it returned.
            await _orderService.AddRefundedAmountAsync(orderId, refundAmount.Value);
        }

        // Payment status is re-derived here because the total just moved: an unpaid order edited
        // upward still owes more, even though there was no captured payment to top up.
        var refreshed = await _orderService.RefreshPaymentStateAsync(orderId);
        return Ok(new UpdateMyOrderResponse(
            refreshed!.ToResponse(), null, null, refundAmount, removedCouponCode));
    }

    /// <summary>
    /// The customer walking away from an edit they were asked to pay for. Their order goes back to
    /// exactly what it was and the extra stock goes back on the shelf; nothing is charged. Also
    /// what the browser calls when it lands back from the payment page having paid nothing.
    /// </summary>
    [HttpDelete("my/{orderId}/amendment")]
    public async Task<ActionResult<OrderResponse>> DiscardMyOrderAmendment(string orderId)
    {
        var userId = User.FindFirstValue(ClaimTypes.NameIdentifier);
        if (userId == null) return Unauthorized();

        var order = await _orderService.GetOrderByIdAsync(orderId);
        if (order == null)
            return NotFound(new { message = "Order not found." });

        if (!string.Equals(order.UserId, userId, StringComparison.Ordinal))
            return Forbid();

        await _paymentOutcome.DiscardAsync(orderId);

        // Money can have landed between the customer deciding to drop the changes and this
        // arriving, in which case it is theirs to have back rather than ours to keep.
        await _paymentOutcome.ReturnUnappliedOverpaymentAsync(orderId);

        var refreshed = await _orderService.GetOrderByIdAsync(orderId);
        return Ok(refreshed!.ToResponse());
    }

    /// <summary>
    /// Pays what a live order still owes.
    ///
    /// This closes a hole that left customers stuck: an order whose payment was never completed
    /// sat in their list saying "Payment Pending" with an Edit button, a Cancel button, and no way
    /// whatsoever to pay for it. Nothing resolved it either, because the only thing that ever
    /// asked the gateway what happened was the redirect back from the payment page — which is
    /// precisely the step a customer who abandoned the payment never took.
    ///
    /// Two rules shape the order of what happens below:
    ///
    /// <para><em>Never invite a second payment for money that has already arrived.</em> Cashfree
    /// is asked about every payment raised against this order <b>before</b> a new one is created,
    /// so a payment that succeeded while the browser was closed is recorded and the customer is
    /// told the order is settled rather than being sent to pay again. A payment the bank is still
    /// deciding on blocks a new one for the same reason.</para>
    ///
    /// <para><em>The amount is computed here, never sent by the browser.</em> It is the order's
    /// own total less everything already settled against it — captured payments and any discount
    /// the gateway applied on its own page.</para>
    ///
    /// A fresh gateway order is raised rather than reusing the session the order was created with:
    /// that one expires, and handing a customer an expired payment page is the same dead end in a
    /// different costume.
    /// </summary>
    [HttpPost("my/{orderId}/pay")]
    public async Task<ActionResult<ResumePaymentResponse>> ResumeMyOrderPayment(string orderId)
    {
        var userId = User.FindFirstValue(ClaimTypes.NameIdentifier);
        if (userId == null) return Unauthorized();

        if (!_cashfreeService.IsConfigured)
            return StatusCode(StatusCodes.Status503ServiceUnavailable, new { message = "Online payment is temporarily unavailable. Please try again shortly." });

        var order = await _orderService.GetOrderByIdAsync(orderId);
        if (order == null)
            return NotFound(new { message = "Order not found." });

        if (!string.Equals(order.UserId, userId, StringComparison.Ordinal))
            return Forbid();

        // Also covers an order stood down after its payment failed: standing one down cancels it,
        // puts the stock back and returns any wallet credit, so there is nothing left to pay for.
        // That order's route forward is "Try payment again", which places it afresh.
        if (string.Equals(order.Status, "Cancelled", StringComparison.OrdinalIgnoreCase))
            return BadRequest(new { message = "This order was cancelled, so there is nothing to pay." });

        if (order.ReplacedByOrderId != null)
            return BadRequest(new { message = "This attempt was replaced by a newer order. Please pay for that one instead." });

        // A pending edit has its own gateway order for its own amount, and its own Pay button.
        // Raising a second payment for the order's balance alongside it is how a customer ends up
        // paying for the same change twice.
        if (order.PendingAmendment != null)
            return BadRequest(new
            {
                message = "There are changes on this order waiting on payment. Pay for those, or discard them, first.",
                amendmentPending = true,
            });

        // Everything below hangs on this: what the gateway says, not what we last wrote down.
        var reconciled = await _paymentOutcome.ReconcileWithGatewayAsync(orderId);
        order = reconciled.Order;

        var due = Math.Round(order.TotalAmount - order.SettledAmount, 2, MidpointRounding.AwayFromZero);

        if (due <= 0)
        {
            _logger.LogInformation(
                "Order {OrderId} was already settled when the customer asked to pay; nothing raised.", orderId);
            return Ok(new ResumePaymentResponse(order.ToResponse(), 0m, AlreadyPaid: true));
        }

        if (reconciled.AnyInFlight)
            return Ok(new ResumePaymentResponse(order.ToResponse(), due, PaymentInFlight: true));

        // Its own gateway order id: Cashfree refuses a reused one, and every later status check
        // has to be able to ask about this attempt specifically.
        var gatewayOrderId = CashfreeService.TopUpOrderId(orderId);
        CashfreeOrderResult session;
        try
        {
            session = await _cashfreeService.CreateOrderAsync(order, due, gatewayOrderId);
        }
        catch (Exception ex)
        {
            // Nothing was written, so there is nothing to roll back — the order is exactly as it
            // was and the customer can try again.
            _logger.LogError(ex, "Cashfree order creation failed resuming payment for order {OrderId}", orderId);
            return StatusCode(StatusCodes.Status502BadGateway, new { message = "We couldn't start the payment. Your order is unchanged - please try again." });
        }

        // Without this the attempt is invisible to every later status check and to the
        // reconciliation above, since it lives under an id the order doesn't otherwise know.
        await _orderService.AddPaymentAttemptAsync(orderId, gatewayOrderId, due);
        await _orderService.SetPaymentSessionAsync(orderId, session.PaymentSessionId);

        var refreshed = await _orderService.GetOrderByIdAsync(orderId) ?? order;
        return Ok(new ResumePaymentResponse(refreshed.ToResponse(), due, session.PaymentSessionId));
    }

    /// <summary>
    /// Customer cancels their own order while it is still Pending or Confirmed. Money already
    /// captured comes back either as wallet credit (instantly — nothing leaves the business) or
    /// to the original payment method, which is queued for an admin to action. Whatever was paid
    /// from wallet in the first place always returns to the wallet, since refunding store credit
    /// to a card isn't a thing.
    /// </summary>
    [HttpPatch("my/{orderId}/cancel")]
    public async Task<ActionResult<CancelOrderResponse>> CancelMyOrder(
        string orderId, [FromBody] CancelOrderRequest? request = null)
    {
        var userId = User.FindFirstValue(ClaimTypes.NameIdentifier);
        if (userId == null) return Unauthorized();

        var destination = request?.RefundDestination ?? RefundDestinations.Wallet;
        if (!RefundDestinations.IsValid(destination))
            return BadRequest(new { message = "Invalid refund destination." });

        var order = await _orderService.GetOrderByIdAsync(orderId);
        if (order == null)
            return NotFound(new { message = "Order not found." });

        if (!string.Equals(order.UserId, userId, StringComparison.Ordinal))
            return Forbid();

        if (string.Equals(order.Status, "Cancelled", StringComparison.OrdinalIgnoreCase))
            return Ok(new CancelOrderResponse(0m, 0m, order.ToResponse()));

        if (!OrderService.IsCustomerEditable(order.Status))
            return BadRequest(new
            {
                message = $"This order is already {order.Status.ToLowerInvariant()} and can no longer be cancelled.",
                notEditable = true,
            });

        // Everything a cancellation gives back - the goods, the unpaid edit, wallet credit and
        // captured money - happens in one place, so no caller can end up doing three quarters of
        // it. An admin cancelling used to do exactly that, and kept the customer's money.
        var outcome = await _cancellation.CancelAsync(
            orderId,
            CancellationInitiator.Customer,
            destination,
            OrderService.CustomerCancellableStatuses);

        if (!outcome.Cancelled)
            return Ok(new CancelOrderResponse(0m, 0m, outcome.Order?.ToResponse()));

        return Ok(new CancelOrderResponse(
            outcome.WalletCredited, outcome.SourceRefundQueued, outcome.Order?.ToResponse()));
    }

    [HttpGet("admin/all")]
    [Authorize(Roles = UserRoles.Admin)]
    public async Task<ActionResult<List<OrderResponse>>> GetAllOrdersForAdmin()
    {
        var orders = await _orderService.GetAllOrdersAsync();
        return Ok(orders.Select(OrderMapping.ToResponse).ToList());
    }

    [HttpGet("delivery/my")]
    [Authorize(Roles = UserRoles.Delivery)]
    public async Task<ActionResult<List<OrderResponse>>> GetAssignedOrdersForDelivery()
    {
        var deliveryPartnerId = User.FindFirstValue(ClaimTypes.NameIdentifier);
        if (deliveryPartnerId == null) return Unauthorized();

        var orders = await _orderService.GetOrdersAssignedToDeliveryAsync(deliveryPartnerId);
        return Ok(orders.Select(OrderMapping.ToResponse).ToList());
    }

    [HttpGet("admin/delivery-partners")]
    [Authorize(Roles = UserRoles.Admin)]
    public async Task<ActionResult<List<StaffUserResponse>>> GetDeliveryPartners()
    {
        var users = await _db.Users
            .Find(u => u.Role == UserRoles.Delivery)
            .SortBy(u => u.FullName)
            .ToListAsync();

        // An empty password hash means the invite was never accepted - surfaced so the admin can
        // see a stalled onboarding rather than wondering why someone never appears online.
        return Ok(users
            .Select(u => new StaffUserResponse(
                u.Id!, u.FullName, u.Email, u.Phone, u.Role, string.IsNullOrEmpty(u.PasswordHash),
                AuthService.HasActiveDeviceApproval(u) ? u.PendingDeviceApprovalExpiresAt : null))
            .ToList());
    }

    /// <summary>
    /// Admin moves an order along. Cancelling is not just another status: it gives the goods and
    /// the money back, through the same path a customer cancel takes, and to the customer's
    /// original payment method - a merchant-initiated cancellation must never quietly convert
    /// someone's card payment into store credit they didn't ask for.
    /// </summary>
    [HttpPatch("admin/{orderId}/status")]
    [Authorize(Roles = UserRoles.Admin)]
    public async Task<ActionResult<AdminStatusChangeResponse>> UpdateOrderStatusAsAdmin(
        string orderId, [FromBody] UpdateOrderStatusRequest request)
    {
        var normalizedStatus = OrderService.NormalizeStatus(request.Status);
        if (normalizedStatus == null)
            return BadRequest(new { message = "Invalid status value." });

        var order = await _orderService.GetOrderByIdAsync(orderId);
        if (order == null)
            return NotFound(new { message = "Order not found." });

        if (normalizedStatus == "Cancelled")
        {
            // The cancellation itself is what claims the right to hand everything back, so a
            // double-click can't restore the stock or refund the money twice.
            var outcome = await _cancellation.CancelAsync(
                orderId, CancellationInitiator.Admin, RefundDestinations.Source);

            if (outcome.Cancelled)
                _logger.LogInformation(
                    "Admin {AdminId} cancelled order {OrderId}.",
                    User.FindFirstValue(ClaimTypes.NameIdentifier), orderId);

            return Ok(new AdminStatusChangeResponse(
                outcome.Order?.ToResponse(),
                outcome.WalletCredited,
                outcome.RefundedToSource,
                outcome.SourceRefundQueued,
                outcome.RefundError));
        }

        var updated = await _orderService.UpdateOrderStatusAsync(orderId, normalizedStatus);
        if (!updated)
            return NotFound(new { message = "Order not found." });

        var refreshed = await _orderService.GetOrderByIdAsync(orderId);
        return Ok(new AdminStatusChangeResponse(refreshed?.ToResponse(), 0m, 0m, 0m, null));
    }

    /// <summary>What a cancelling admin is about to hand back, worked out server-side so the
    /// confirmation they see is the real figure rather than the dashboard's own arithmetic.</summary>
    [HttpGet("admin/{orderId}/cancellation-preview")]
    [Authorize(Roles = UserRoles.Admin)]
    public async Task<ActionResult<CancellationPreviewResponse>> PreviewCancellation(string orderId)
    {
        var order = await _orderService.GetOrderByIdAsync(orderId);
        if (order == null)
            return NotFound(new { message = "Order not found." });

        var walletShare = Math.Min(order.WalletAmountApplied, order.AmountPaid);
        var gatewayShare = Math.Round(order.AmountPaid - walletShare, 2, MidpointRounding.AwayFromZero);

        return Ok(new CancellationPreviewResponse(
            Math.Round(order.AmountPaid, 2, MidpointRounding.AwayFromZero),
            walletShare,
            gatewayShare,
            order.PendingAmendment != null));
    }

    /// <summary>Server-side, admin-only, audited refund - the amount is re-validated against
    /// what this order actually captured on every call, never trusted from the request alone,
    /// and split across the gateway orders that hold the money rather than aimed at the original
    /// one, which would miss every top-up.</summary>
    [HttpPost("admin/{orderId}/refund")]
    [Authorize(Roles = UserRoles.Admin)]
    public async Task<IActionResult> RefundOrder(string orderId, [FromBody] RefundOrderRequest request)
    {
        var order = await _orderService.GetOrderByIdAsync(orderId);
        if (order == null)
            return NotFound(new { message = "Order not found." });

        if (order.PaymentMethod != OnlinePaymentMethod || order.AmountPaid <= 0)
            return BadRequest(new { message = "This order has no captured online payment to refund." });

        if (request.RefundAmount <= 0)
            return BadRequest(new { message = "Refund amount must be positive." });

        if (request.RefundAmount > order.AmountPaid)
            return BadRequest(new { message = "Refund amount cannot exceed the amount actually paid." });

        var outcome = await _cancellation.RefundToSourceAsync(orderId, request.RefundAmount, request.Note);

        if (outcome.Refunded <= 0)
            return StatusCode(StatusCodes.Status502BadGateway, new { message = outcome.Error });

        // The money is on its way back, so the queued reminder is discharged by however much of
        // it went out - a partly successful refund must leave the rest still showing as owed.
        var stillOwed = Math.Round((order.RefundPendingAmount ?? 0m) - outcome.Refunded, 2, MidpointRounding.AwayFromZero);
        await _orderService.SetRefundPendingAsync(orderId, stillOwed > 0 ? stillOwed : null);
        var refreshed = await _orderService.RefreshPaymentStateAsync(orderId);

        _logger.LogInformation(
            "Admin {AdminId} refunded {Amount} for order {OrderId}.",
            User.FindFirstValue(ClaimTypes.NameIdentifier), outcome.Refunded, orderId);

        return Ok(new RefundOrderResponse(outcome.Refunded, outcome.Error, refreshed?.ToResponse()));
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

    /// <summary>Recorded separately from marking the order Delivered - a partner can hand
    /// over the goods without successfully collecting payment, and that has to stay visible
    /// to admins rather than being implied by delivery status alone.</summary>
    [HttpPatch("delivery/{orderId}/payment-collected")]
    [Authorize(Roles = UserRoles.Delivery)]
    public async Task<IActionResult> MarkPaymentCollected(string orderId)
    {
        var deliveryPartnerId = User.FindFirstValue(ClaimTypes.NameIdentifier);
        if (deliveryPartnerId == null) return Unauthorized();

        var order = await _orderService.GetOrderByIdAsync(orderId);
        if (order == null)
            return NotFound(new { message = "Order not found." });

        if (!string.Equals(order.DeliveryPartnerId, deliveryPartnerId, StringComparison.Ordinal))
            return Forbid();

        if (string.Equals(order.PaymentStatus, "Collected", StringComparison.OrdinalIgnoreCase))
            return NoContent();

        // Only a legacy COD order has cash to collect at the door. Allowing this on an order paid
        // online would overwrite a real "Paid" (or "Failed") state with "Collected" and lose what
        // actually happened to the money - the UI hides the button, but the endpoint is the
        // authority on that, not the button.
        if (!string.Equals(order.PaymentMethod, "COD", StringComparison.OrdinalIgnoreCase))
            return BadRequest(new { message = "This order was paid online - there is no cash to collect." });

        var updated = await _orderService.MarkPaymentCollectedAsync(orderId);
        if (!updated)
            return NotFound(new { message = "Order not found." });

        return NoContent();
    }
}
