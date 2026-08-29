namespace OjasApi.Models;

/// <summary>
/// Turns a stored order into the shape the API returns. Shared rather than private to a
/// controller because more than one endpoint has to hand back a whole order — notably the payment
/// status check, which is the moment an order changes most: the money it holds, its status, and
/// (when a pending edit was paid for) its items and total all move at once. Returning the order
/// itself is what saves the browser from patching a field or two and quietly keeping the rest of
/// its stale copy.
/// </summary>
public static class OrderMapping
{
    public static OrderResponse ToResponse(this Order order) =>
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
            order.RefundedToWallet);

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
