using MailKit.Net.Smtp;
using MailKit.Security;
using MimeKit;

namespace OjasApi.Services;

/// <summary>
/// Sends transactional email via Hostinger's SMTP relay for wecare@ojasaata.com, replacing
/// Brevo (suspended, unrecoverable). This makes a real SMTP connection rather than an HTTP API
/// call - some hosts block outbound SMTP ports, which is why the /api/debug/smtp-test endpoint
/// existed briefly to prove this actually gets through from Render before relying on it. Port
/// and TLS mode are both configurable (confirmed for this mailbox: 465/implicit-TLS) since which
/// combination works isn't guaranteed the same for every provider.
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

        using var client = new SmtpClient();
        var secureSocketOptions = useSsl ? SecureSocketOptions.SslOnConnect : SecureSocketOptions.StartTls;
        await client.ConnectAsync(host, port, secureSocketOptions);
        await client.AuthenticateAsync(username, password);
        await client.SendAsync(message);
        await client.DisconnectAsync(true);
    }
}
