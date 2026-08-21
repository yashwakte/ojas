namespace OjasApi.Services;

/// <summary>
/// Fails immediately rather than attempting a network call - the active IEmailSender whenever no
/// working delivery mechanism actually exists. Confirmed 2026-08-21: Hostinger SMTP (both port
/// 465/SSL and 587/STARTTLS) times out from Render, meaning Render blocks outbound SMTP
/// entirely, and Brevo's account is suspended and unrecoverable. Every OTP/invite/reset caller
/// already catches SendAsync and degrades gracefully (the code is still generated and logged;
/// only the email itself doesn't go out) - what this fixes is that those callers were previously
/// awaiting a real SMTP connection attempt that hung for MailKit's ~100s default timeout on every
/// single call, making every affected endpoint agonizingly slow instead of failing fast. Swap
/// this out for a real HTTP-API-based sender once one is chosen and configured.
/// </summary>
public class NotConfiguredEmailSender : IEmailSender
{
    public Task SendAsync(string toEmail, string subject, string htmlBody) =>
        throw new InvalidOperationException(
            "Email sending is not currently configured - Brevo is suspended and outbound SMTP is blocked from this host.");
}
