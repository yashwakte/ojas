using System.Net.Http.Headers;
using System.Text;
using System.Text.Json;

namespace OjasApi.Services;

/// <summary>
/// Sends transactional email via Resend's HTTP API. Chosen over SMTP because Render blocks
/// outbound SMTP entirely (confirmed 2026-08-21 against Hostinger's relay on both port 465 and
/// 587) - an ordinary HTTPS POST is unaffected by that. Sends from a dedicated subdomain
/// (notifications.ojasaata.com) rather than the root domain, on Resend's own deliverability
/// guidance, so that high-volume OTP mail can never damage the sending reputation of
/// wecare@ojasaata.com - which is also why Reply-To is set back to that address: a customer who
/// hits reply on an OTP email still lands in the real, human-read Hostinger mailbox rather than a
/// subdomain nobody checks.
/// </summary>
public class ResendEmailSender : IEmailSender
{
    private const string SendUrl = "https://api.resend.com/emails";

    private readonly HttpClient _http;
    private readonly IConfiguration _config;
    private readonly ILogger<ResendEmailSender> _logger;

    public ResendEmailSender(HttpClient http, IConfiguration config, ILogger<ResendEmailSender> logger)
    {
        _http = http;
        _config = config;
        _logger = logger;
    }

    public bool IsConfigured =>
        !string.IsNullOrWhiteSpace(_config["Resend:ApiKey"]) &&
        !string.IsNullOrWhiteSpace(_config["Resend:FromEmail"]);

    public async Task SendAsync(string toEmail, string subject, string htmlBody)
    {
        var apiKey = _config["Resend:ApiKey"];
        var fromEmail = _config["Resend:FromEmail"];
        if (string.IsNullOrWhiteSpace(apiKey) || string.IsNullOrWhiteSpace(fromEmail))
        {
            throw new InvalidOperationException(
                "Email sending is not configured (Resend:ApiKey / Resend:FromEmail missing).");
        }

        var fromName = _config["Resend:FromName"];
        if (string.IsNullOrWhiteSpace(fromName))
            fromName = "Ojas";
        var replyTo = _config["Resend:ReplyTo"];

        var payload = new Dictionary<string, object?>
        {
            ["from"] = $"{fromName} <{fromEmail}>",
            ["to"] = new[] { toEmail },
            ["subject"] = subject,
            ["html"] = htmlBody,
        };
        if (!string.IsNullOrWhiteSpace(replyTo))
            payload["reply_to"] = replyTo;

        using var request = new HttpRequestMessage(HttpMethod.Post, SendUrl)
        {
            Content = new StringContent(JsonSerializer.Serialize(payload), Encoding.UTF8, "application/json"),
        };
        request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", apiKey);

        using var response = await _http.SendAsync(request);
        var body = await response.Content.ReadAsStringAsync();

        if (!response.IsSuccessStatusCode)
        {
            // Every OTP/invite/reset caller already catches this and degrades gracefully (the
            // code is still generated and logged, just not delivered) - logging the body here is
            // what makes a bad API key or an unverified sender visible without a customer report.
            _logger.LogError(
                "Resend send to {ToEmail} failed ({Status}): {Body}", toEmail, (int)response.StatusCode, body);
            throw new InvalidOperationException($"Resend send failed ({(int)response.StatusCode}): {body}");
        }
    }
}
