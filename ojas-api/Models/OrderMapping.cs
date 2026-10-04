namespace OjasApi.Models;

/// <summary>
/// Turns a stored order into the shape the API returns. Shared rather than private to a
/// controller because more than one endpoint has to hand back a whole order — notably the payment
/// status check, which is the moment an order changes most: the money it holds, its status, and
/// (when a pending edit was paid for) its items and total all move at once. Returning the order
/// itself is what saves the browser from patching a field or two and quietly keeping the rest of
/// its stale copy.
///
/// Each caller gets only what its screen uses. The customer's view leaves out the internal id of
/// the staff account delivering the order, and the gateway session id - which is handed over once,
/// in the response to placing the order, and has no business sitting on every order in a list
/// afterwards. A delivery partner gets <see cref="DeliveryOrderResponse"/>, which carries none of
/// the money internals (sessions, refunds, wallet, coupons, failure reasons) of an order that is
/// not theirs. Only an admin sees the whole order.
/// </summary>
public static class OrderMapping
{
    /// <summary>The customer's view of their own order.</summary>
    public static OrderResponse ToResponse(this Order order) =>
        order.ToFullResponse() with { PaymentSessionId = null, DeliveryPartnerId = null };

    /// <summary>The customer's view, plus the session id the browser needs to open the payment
    /// page - only for the response to placing (or re-submitting) the order.</summary>
    public static OrderResponse ToPlacedResponse(this Order order) =>
        order.ToFullResponse() with { DeliveryPartnerId = null };

    /// <summary>The admin dashboard's view. It needs the partner id to drive assignment; it never
    /// opens a payment page, so it gets no session id either.</summary>
    public static OrderResponse ToAdminResponse(this Order order) =>
        order.ToFullResponse() with { PaymentSessionId = null };

    /// <summary>What a delivery partner needs to find the customer and hand the order over.</summary>
    public static DeliveryOrderResponse ToDeliveryResponse(this Order order) =>
        new(
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
            order.PaymentMethod,
            order.PaymentStatus,
            order.CreatedAt,
            order.DeliveredAt);

    private static OrderResponse ToFullResponse(this Order order) =>
        new(
            order.Id!,
            order.FullName,
            order.Phone,
            order.Address,
            order.Latitude,
            order.Longitude,
            order.AddressMapLink,
            order.Notes,
            order.Items.Select(i => new OrderItemDto(i.ProductId, i.ProductName, i.Price, i.Weight, i.Quantity)).ToList(),
            order.Subtotal,
            order.CouponCode,
            order.DiscountPercentage,
            order.DiscountAmount,
            order.DeliveryCharge,
            order.DeliveryDistanceKm,
            order.TotalAmount,
            order.Status,
            order.PaymentMethod,
            order.PaymentStatus,
            order.CreatedAt,
            order.DeliveryPartnerId,
            order.DeliveryPartnerName,
            order.UpdatedAt,
            order.PaymentSessionId,
            order.PaymentInstrument,
            order.AmountPaid,
            order.RefundPendingAmount,
            order.WalletAmountApplied,
            order.PendingAmendment.ToResponse(),
            order.PaymentFailureReason,
            order.GatewayDiscountTotal,
            order.AmountRefunded,
            order.RefundedToSource,
            order.RefundedToWallet,
            order.DeliveredAt,
            // Only a delivered order has a window at all, and it is computed from the same policy
            // constant the API enforces - never from the page's own idea of three days.
            order.DeliveredAt == null && !string.Equals(order.Status, "Delivered", StringComparison.OrdinalIgnoreCase)
                ? null
                : ReturnPolicy.WindowEndsAt(order.ReturnWindowStartsAt));

    public static PendingAmendmentDto? ToResponse(this OrderAmendment? amendment) =>
        amendment == null
            ? null
            : new PendingAmendmentDto(
                amendment.Items.Select(i => new OrderItemDto(i.ProductId, i.ProductName, i.Price, i.Weight, i.Quantity)).ToList(),
                amendment.Subtotal,
                amendment.CouponCode,
                amendment.DiscountAmount,
                amendment.DeliveryCharge,
                amendment.TotalAmount,
                amendment.TopUpAmount,
                amendment.PaymentSessionId,
                amendment.ExpiresAt);
}
