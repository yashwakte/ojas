using OjasApi.Services;

namespace OjasApi.Models;

/// <summary>
/// Turns stored returns into what the API hands back.
///
/// The customer's shape and the admin's shape are the same record with the identifying fields
/// left null for customers - not two records - so a handler cannot accidentally serve one
/// audience's view to the other by picking the wrong mapper. Filling those fields is an explicit
/// act (<see cref="ToAdminResponse"/>), which is the direction that ought to require a decision.
/// </summary>
public static class ReturnMapping
{
    public static ReturnRequestResponse ToResponse(this ReturnRequest request) =>
        new(
            request.Id!,
            request.OrderId,
            request.Items
                .Select(i => new ReturnRequestItemDto(
                    i.ProductId, i.ProductName, i.Weight, i.Price, i.Quantity, i.RefundAmount))
                .ToList(),
            request.Reason,
            request.Comment,
            request.Status,
            request.RefundDestination,
            request.RefundAmount,
            request.RefundedToWallet,
            request.RefundedToSource,
            request.RefundQueued,
            request.Events
                .Select(e => new ReturnRequestEventDto(e.Status, e.Note, e.By, e.At))
                .ToList(),
            request.CreatedAt,
            request.UpdatedAt);

    /// <summary>The queue view: everything above plus who to call and where to collect from.</summary>
    public static ReturnRequestResponse ToAdminResponse(this ReturnRequest request) =>
        request.ToResponse() with
        {
            CustomerName = request.CustomerName,
            CustomerPhone = request.CustomerPhone,
            PickupAddress = request.PickupAddress,
        };

    public static ReturnEligibilityResponse ToResponse(this ReturnEligibility eligibility) =>
        new(
            eligibility.CanRequest,
            eligibility.Reason,
            eligibility.WindowEndsAt,
            ReturnPolicy.WindowDays,
            eligibility.Refundable,
            eligibility.Items
                .Select(i => new ReturnableItemDto(
                    i.ProductId, i.ProductName, i.Weight, i.Price,
                    i.OrderedQuantity, i.ReturnableQuantity, i.UnitRefund))
                .ToList());
}
