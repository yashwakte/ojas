using System.Security.Claims;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.RateLimiting;
using OjasApi.Models;
using OjasApi.Services;

namespace OjasApi.Controllers;

/// <summary>
/// The customer's own store credit. Read-only by design: balance only ever moves as a
/// consequence of an order being placed, edited or cancelled, so there is deliberately no
/// endpoint here to add, spend or withdraw it directly.
/// </summary>
[ApiController]
[Route("api/[controller]")]
[Authorize]
[EnableRateLimiting("general")]
public class WalletController(WalletService walletService) : ControllerBase
{
    [HttpGet]
    public async Task<ActionResult<WalletResponse>> GetMyWallet()
    {
        var userId = User.FindFirstValue(ClaimTypes.NameIdentifier);
        if (userId == null) return Unauthorized();

        var balance = await walletService.GetBalanceAsync(userId);
        var transactions = await walletService.GetTransactionsAsync(userId);

        return Ok(new WalletResponse(
            balance,
            transactions
                .Select(t => new WalletTransactionResponse(t.Amount, t.BalanceAfter, t.Reason, t.OrderId, t.CreatedAt))
                .ToList()));
    }
}
