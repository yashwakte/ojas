namespace OjasApi.Services;

public interface ITurnstileVerifier
{
    Task<bool> VerifyAsync(string token, string? remoteIp);
}
