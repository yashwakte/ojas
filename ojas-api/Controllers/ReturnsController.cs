using System.Security.Claims;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.RateLimiting;
using OjasApi.Models;
using OjasApi.Services;

namespace OjasApi.Controllers;

/// <summary>
/// Returns: the customer asks for one, and an admin walks it to a refund.
///
/// Two audiences, one controller, split by route prefix and role - "my" for the customer,
/// "admin" for the queue - the same shape the orders API already uses, so there is one place to
/// look for who may do what to a return.
/// </summary>
[ApiController]
[Route("api/[controller]")]
[Authorize]
[EnableRateLimiting("general")]
public class ReturnsController(
    ReturnService returnService,
    OrderService orderService,
    ILogger<ReturnsController> logger) : ControllerBase
{
    private string? CurrentUserId => User.FindFirstValue(ClaimTypes.NameIdentifier);

    /// <summary>What this order can have returned from it, and what each unit is worth back.
    /// The orders page asks before drawing the button, so what the customer is offered and what
    /// the API will accept are the same answer.</summary>
    [HttpGet("eligibility/{orderId}")]
    public async Task<ActionResult<ReturnEligibilityResponse>> GetEligibility(string orderId)
    {
        var userId = CurrentUserId;
        if (userId == null) return Unauthorized();

        var eligibility = await returnService.GetEligibilityAsync(orderId, userId);

        // Someone else's order answers exactly as a missing one: Mongo ObjectIds run in near
        // sequence, and a 403 here would confirm that a guessed id had landed on a real order.
        if (eligibility == null)
            return NotFound(new { message = "Order not found." });

        return Ok(eligibility.ToResponse());
    }

    /// <summary>Every return this customer has raised, newest first.</summary>
    [HttpGet("my")]
    public async Task<ActionResult<List<ReturnRequestResponse>>> GetMyReturns()
    {
        var userId = CurrentUserId;
        if (userId == null) return Unauthorized();

        var requests = await returnService.GetMineAsync(userId);
        return Ok(requests.Select(r => r.ToResponse()).ToList());
    }

    /// <summary>Raises a return. The browser sends products, quantities and a reason; everything
    /// with a rupee sign on it is derived server-side from the order.</summary>
    [HttpPost("my")]
    public async Task<ActionResult<ReturnRequestResponse>> CreateReturn([FromBody] CreateReturnRequest request)
    {
        var userId = CurrentUserId;
        if (userId == null) return Unauthorized();

        var outcome = await returnService.CreateAsync(
            request.OrderId,
            userId,
            request.Items.Select(i => (i.ProductId, i.Quantity)).ToList(),
            request.Reason,
            request.Comment,
            request.RefundDestination);

        if (outcome.Request == null)
            return BadRequest(new { message = outcome.Error ?? "This return could not be raised." });

        logger.LogInformation(
            "Customer {UserId} raised return {ReturnId} on order {OrderId}.",
            userId, outcome.Request.Id, request.OrderId);

        return Ok(outcome.Request.ToResponse());
    }

    /// <summary>The customer calling it off, allowed until we have collected the goods.</summary>
    [HttpPatch("my/{id}/cancel")]
    public async Task<ActionResult<ReturnRequestResponse>> CancelMyReturn(string id)
    {
        var userId = CurrentUserId;
        if (userId == null) return Unauthorized();

        var cancelled = await returnService.CancelByCustomerAsync(id, userId);
        if (cancelled == null)
        {
            return BadRequest(new
            {
                message = "This return can no longer be cancelled. Please call us if you need to change it.",
            });
        }

        return Ok(cancelled.ToResponse());
    }

    // ===== ADMIN =====

    /// <summary>The queue. Everything, newest first, with who to call and where to collect from -
    /// parking work for a human is not finished until a human can see it.</summary>
    [HttpGet("admin/all")]
    [Authorize(Roles = UserRoles.Admin)]
    public async Task<ActionResult<List<ReturnRequestResponse>>> GetAllForAdmin()
    {
        var requests = await returnService.GetAllForAdminAsync();
        return Ok(requests.Select(r => r.ToAdminResponse()).ToList());
    }

    /// <summary>
    /// Moves a return along: approve it, record the pickup, refund it, or refuse it.
    ///
    /// One endpoint rather than four, because the thing that must not be got wrong is which step
    /// may follow which - and that belongs in one place. The service enforces the order of the
    /// steps with a filtered update, so two admins pressing Refund together cannot pay twice.
    /// </summary>
    [HttpPatch("admin/{id}/status")]
    [Authorize(Roles = UserRoles.Admin)]
    public async Task<ActionResult<ReturnSettlementResponse>> UpdateStatus(
        string id, [FromBody] UpdateReturnStatusRequest request)
    {
        var status = ReturnRequestStatuses.Normalize(request.Status);
        if (status == null)
            return BadRequest(new { message = "Unknown return status." });

        var adminId = User.FindFirstValue(ClaimTypes.NameIdentifier);

        switch (status)
        {
            case ReturnRequestStatuses.Approved:
            {
                var approved = await returnService.ApproveAsync(id, request.Note);
                return approved == null
                    ? Conflict(new { message = "Only a newly requested return can be approved." })
                    : Ok(new ReturnSettlementResponse(approved.ToAdminResponse(), 0m, 0m, 0m));
            }

            case ReturnRequestStatuses.PickedUp:
            {
                var picked = await returnService.MarkPickedUpAsync(id, request.Note);
                return picked == null
                    ? Conflict(new { message = "This return is not awaiting a pickup." })
                    : Ok(new ReturnSettlementResponse(picked.ToAdminResponse(), 0m, 0m, 0m));
            }

            case ReturnRequestStatuses.Rejected:
            {
                // A refusal the customer can read. Without one the only way they find out why is
                // to ring us, which is the call this whole flow exists to save.
                if (string.IsNullOrWhiteSpace(request.Note))
                    return BadRequest(new { message = "Give the customer a reason for refusing the return." });

                var rejected = await returnService.RejectAsync(id, request.Note.Trim());
                return rejected == null
                    ? Conflict(new { message = "This return has already been settled." })
                    : Ok(new ReturnSettlementResponse(rejected.ToAdminResponse(), 0m, 0m, 0m));
            }

            case ReturnRequestStatuses.Refunded:
            {
                var settlement = await returnService.RefundAsync(id);
                if (!settlement.Settled)
                    return Conflict(new { message = settlement.RefundError ?? "This return could not be refunded." });

                logger.LogInformation(
                    "Admin {AdminId} refunded return {ReturnId}.", adminId, id);

                return Ok(new ReturnSettlementResponse(
                    settlement.Request?.ToAdminResponse(),
                    settlement.WalletCredited,
                    settlement.RefundedToSource,
                    settlement.RefundQueued,
                    settlement.RefundError));
            }

            default:
                // Requested is where a return starts and Cancelled is the customer's own word;
                // neither is something an admin sets from here.
                return BadRequest(new { message = "That is not a step an admin can take on a return." });
        }
    }

    /// <summary>Every return raised against one order, for the admin looking at that order.</summary>
    [HttpGet("admin/order/{orderId}")]
    [Authorize(Roles = UserRoles.Admin)]
    public async Task<ActionResult<List<ReturnRequestResponse>>> GetForOrder(string orderId)
    {
        var order = await orderService.GetOrderByIdAsync(orderId);
        if (order == null)
            return NotFound(new { message = "Order not found." });

        var all = await returnService.GetAllForAdminAsync();
        return Ok(all.Where(r => r.OrderId == orderId).Select(r => r.ToAdminResponse()).ToList());
    }
}
