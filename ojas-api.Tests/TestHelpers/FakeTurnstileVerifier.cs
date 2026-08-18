using OjasApi.Services;

namespace OjasApi.Tests.TestHelpers;

/// <summary>Always passes - swapped in for the real CloudflareTurnstileVerifier in integration
/// tests so the suite doesn't depend on a live call to Cloudflare's siteverify endpoint.</summary>
public class FakeTurnstileVerifier : ITurnstileVerifier
{
    public Task<bool> VerifyAsync(string token, string? remoteIp) => Task.FromResult(true);
}
