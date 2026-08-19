using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.RateLimiting;
using OjasApi.Models;
using OjasApi.Services;

namespace OjasApi.Controllers;

[ApiController]
[Route("api/[controller]")]
[EnableRateLimiting("general")]
public class ChatbotController : ControllerBase
{
    private readonly ChatbotService _chatbot;

    public ChatbotController(ChatbotService chatbot)
    {
        _chatbot = chatbot;
    }

    // Deliberately anonymous - most topics (stock, delivery charges, cancellation policy) need
    // no login. ChatbotService checks User.Identity itself for the one topic that does
    // (order-status), rather than the endpoint requiring auth for everyone.
    [HttpPost("ask")]
    public async Task<ActionResult<ChatbotResponse>> Ask([FromBody] ChatbotRequest request)
    {
        var response = await _chatbot.AnswerAsync(request, User);
        return Ok(response);
    }
}
