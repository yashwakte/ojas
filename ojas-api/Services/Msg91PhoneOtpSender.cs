namespace OjasApi.Services;

/// <summary>
/// Scaffolded ahead of time so switching phone OTP on is purely a config change - add
/// Msg91:AuthKey, Msg91:TemplateId and Msg91:SenderId (the DLT-approved template id and
/// sender header) once that registration is done, and IsConfigured flips true with no code
/// changes needed. Until then this stays inert; callers must check IsConfigured before
/// calling SendAsync.
/// </summary>
public class Msg91PhoneOtpSender : IPhoneOtpSender
{
    private readonly HttpClient _http;
    private readonly IConfiguration _config;

    public Msg91PhoneOtpSender(HttpClient http, IConfiguration config)
    {
        _http = http;
        _config = config;
    }

    public bool IsConfigured =>
        !string.IsNullOrWhiteSpace(_config["Msg91:AuthKey"]) &&
        !string.IsNullOrWhiteSpace(_config["Msg91:TemplateId"]) &&
        !string.IsNullOrWhiteSpace(_config["Msg91:SenderId"]);

    public async Task SendAsync(string phoneNumber, string code)
    {
        if (!IsConfigured)
            throw new InvalidOperationException("Phone verification is not configured yet.");

        var authKey = _config["Msg91:AuthKey"];
        var templateId = _config["Msg91:TemplateId"];
        var senderId = _config["Msg91:SenderId"];

        var url = "https://control.msg91.com/api/v5/otp" +
            $"?otp={code}&mobile=91{phoneNumber}&template_id={templateId}&sender={senderId}";

        using var request = new HttpRequestMessage(HttpMethod.Post, url);
        request.Headers.Add("authkey", authKey);

        var response = await _http.SendAsync(request);
        if (!response.IsSuccessStatusCode)
        {
            var body = await response.Content.ReadAsStringAsync();
            throw new InvalidOperationException($"MSG91 send failed ({(int)response.StatusCode}): {body}");
        }
    }
}
