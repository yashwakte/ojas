using OjasApi.Services;

namespace OjasApi.Tests.TestHelpers;

/// <summary>Reports configured and no-ops on send - swapped in for the real Msg91PhoneOtpSender
/// so phone-login tests can exercise the "MSG91 is live" path without real MSG91 credentials or
/// a live network call.</summary>
public class FakePhoneOtpSender : IPhoneOtpSender
{
    public bool IsConfigured => true;

    public Task SendAsync(string phoneNumber, string code) => Task.CompletedTask;
}
