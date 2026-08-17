using System.Text;
using System.Text.Json;

namespace OjasApi.Services;

/// <summary>
/// Sends transactional email via Brevo's HTTP API (not raw SMTP - some hosts block outbound
/// SMTP ports, and an HTTP call sidesteps that entirely). Needs Brevo:ApiKey and
/// Brevo:SenderEmail configured; until then, throws so callers can decide how to degrade
/// (OtpService logs it and still returns the generated code for local/dev use).
/// </summary>
public class BrevoEmailSender : IEmailSender
{
    private readonly HttpClient _http;
    private readonly IConfiguration _config;

    public BrevoEmailSender(HttpClient http, IConfiguration config)
    {
        _http = http;
        _config = config;
    }

    public async Task SendAsync(string toEmail, string subject, string htmlBody)
    {
        var apiKey = _config["Brevo:ApiKey"];
        var senderEmail = _config["Brevo:SenderEmail"];
        var senderName = _config["Brevo:SenderName"];
        if (string.IsNullOrWhiteSpace(senderName))
            senderName = "Ojas";

        if (string.IsNullOrWhiteSpace(apiKey) || string.IsNullOrWhiteSpace(senderEmail))
            throw new InvalidOperationException("Email sending is not configured (Brevo:ApiKey / Brevo:SenderEmail missing).");

        var payload = new
        {
            sender = new { name = senderName, email = senderEmail },
            to = new[] { new { email = toEmail } },
            subject,
            htmlContent = htmlBody,
        };

        using var request = new HttpRequestMessage(HttpMethod.Post, "https://api.brevo.com/v3/smtp/email");
        request.Headers.Add("api-key", apiKey);
        request.Headers.Add("accept", "application/json");
        request.Content = new StringContent(JsonSerializer.Serialize(payload), Encoding.UTF8, "application/json");

        var response = await _http.SendAsync(request);
        if (!response.IsSuccessStatusCode)
        {
            var body = await response.Content.ReadAsStringAsync();
            throw new InvalidOperationException($"Brevo send failed ({(int)response.StatusCode}): {body}");
        }
    }
}
