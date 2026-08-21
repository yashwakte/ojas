namespace OjasApi.Services;

/// <summary>
/// Stands in for the real sender outside Production. Every OTP flow already hands the code back
/// in the response as devCode and the UI shows it, so actually delivering the mail adds nothing
/// locally while spending real send volume against the mailbox - a single end-to-end test run registers,
/// approves devices and resets passwords enough times to make that add up.
/// </summary>
public class LoggingEmailSender : IEmailSender
{
    private readonly ILogger<LoggingEmailSender> _logger;

    public LoggingEmailSender(ILogger<LoggingEmailSender> logger)
    {
        _logger = logger;
    }

    public Task SendAsync(string toEmail, string subject, string htmlBody)
    {
        _logger.LogInformation(
            "Email suppressed outside Production: \"{Subject}\" to {ToEmail}. " +
            "Use the devCode in the API response, or set Email:SendInDevelopment=true to send for real.",
            subject,
            toEmail);

        return Task.CompletedTask;
    }
}
