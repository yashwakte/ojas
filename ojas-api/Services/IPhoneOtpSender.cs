namespace OjasApi.Services;

public interface IPhoneOtpSender
{
    /// <summary>True once MSG91 credentials + a DLT-approved template are configured.</summary>
    bool IsConfigured { get; }

    Task SendAsync(string phoneNumber, string code);
}
