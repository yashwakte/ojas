using MailKit.Net.Smtp;
using MailKit.Security;
using MimeKit;

namespace OjasApi.Services;

/// <summary>
/// Sends transactional email via raw SMTP - kept in the codebase for a host that actually allows
/// outbound SMTP, but NOT currently registered as the live IEmailSender (see Program.cs).
/// Confirmed live 2026-08-21 with Hostinger's relay for wecare@ojasaata.com: Render blocks
/// outbound SMTP entirely, both port 465 (implicit TLS) and 587 (STARTTLS) time out rather than
/// connect - this is exactly the failure mode Brevo's original HTTP API was chosen to avoid. An
/// explicit short connect timeout means that if this is ever re-enabled somewhere SMTP genuinely
/// works, a real failure still surfaces in seconds rather than MailKit's ~100s default.
/// </summary>
public class SmtpEmailSender : IEmailSender
{
    private readonly IConfiguration _config;

    public SmtpEmailSender(IConfiguration config)
    {
        _config = config;
    }

    public async Task SendAsync(string toEmail, string subject, string htmlBody)
    {
        var host = _config["Smtp:Host"];
        var username = _config["Smtp:Username"];
        var password = _config["Smtp:Password"];
        var senderEmail = _config["Smtp:SenderEmail"];
        var senderName = _config["Smtp:SenderName"];
        if (string.IsNullOrWhiteSpace(senderName))
            senderName = "Ojas";

        if (string.IsNullOrWhiteSpace(host) || string.IsNullOrWhiteSpace(username) ||
            string.IsNullOrWhiteSpace(password) || string.IsNullOrWhiteSpace(senderEmail))
        {
            throw new InvalidOperationException(
                "Email sending is not configured (Smtp:Host / Smtp:Username / Smtp:Password / Smtp:SenderEmail missing).");
        }

        var port = _config.GetValue<int?>("Smtp:Port") ?? 587;
        // true = implicit TLS (typically port 465); false = STARTTLS negotiated after connecting
        // in plaintext (typically port 587, Hostinger's documented default). Both ultimately
        // result in an encrypted connection - this only controls which handshake is used.
        var useSsl = _config.GetValue<bool?>("Smtp:UseSsl") ?? false;

        var message = new MimeMessage();
        message.From.Add(new MailboxAddress(senderName, senderEmail));
        message.To.Add(MailboxAddress.Parse(toEmail));
        message.Subject = subject;
        message.Body = new BodyBuilder { HtmlBody = htmlBody }.ToMessageBody();

        using var client = new SmtpClient { Timeout = 15000 };
        var secureSocketOptions = useSsl ? SecureSocketOptions.SslOnConnect : SecureSocketOptions.StartTls;
        await client.ConnectAsync(host, port, secureSocketOptions);
        await client.AuthenticateAsync(username, password);
        await client.SendAsync(message);
        await client.DisconnectAsync(true);
    }
}
