using System.Net;
using System.Net.Http.Headers;
using System.Text.Json;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.Logging.Abstractions;
using OjasApi.Services;
using Shouldly;

namespace OjasApi.Tests.Services;

public class ResendEmailSenderTests
{
    private sealed class FakeHandler(Func<HttpRequestMessage, HttpResponseMessage> respond) : HttpMessageHandler
    {
        public HttpRequestMessage? LastRequest { get; private set; }
        public string? LastBody { get; private set; }

        protected override async Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancellationToken)
        {
            LastRequest = request;
            LastBody = request.Content == null ? null : await request.Content.ReadAsStringAsync(cancellationToken);
            return respond(request);
        }
    }

    private static IConfiguration ConfiguredSettings(string? replyTo = "wecare@ojasaata.com") =>
        new ConfigurationBuilder()
            .AddInMemoryCollection(new Dictionary<string, string?>
            {
                ["Resend:ApiKey"] = "re_test_key",
                ["Resend:FromEmail"] = "wecare@notifications.ojasaata.com",
                ["Resend:FromName"] = "Ojas",
                ["Resend:ReplyTo"] = replyTo,
            })
            .Build();

    private static IConfiguration UnconfiguredSettings() => new ConfigurationBuilder().Build();

    private static (ResendEmailSender Sender, FakeHandler Handler) MakeSender(
        Func<HttpRequestMessage, HttpResponseMessage> respond, IConfiguration? config = null)
    {
        var handler = new FakeHandler(respond);
        var sender = new ResendEmailSender(new HttpClient(handler), config ?? ConfiguredSettings(), NullLogger<ResendEmailSender>.Instance);
        return (sender, handler);
    }

    // ---------- IsConfigured ----------

    [Fact]
    public void IsConfigured_IsFalse_WhenApiKeyOrFromEmailMissing()
    {
        var (sender, _) = MakeSender(_ => new HttpResponseMessage(HttpStatusCode.OK), UnconfiguredSettings());

        sender.IsConfigured.ShouldBeFalse();
    }

    [Fact]
    public void IsConfigured_IsTrue_WhenBothPresent()
    {
        var (sender, _) = MakeSender(_ => new HttpResponseMessage(HttpStatusCode.OK));

        sender.IsConfigured.ShouldBeTrue();
    }

    // ---------- SendAsync ----------

    [Fact]
    public async Task SendAsync_Throws_WhenUnconfigured()
    {
        var (sender, _) = MakeSender(_ => new HttpResponseMessage(HttpStatusCode.OK), UnconfiguredSettings());

        await Should.ThrowAsync<InvalidOperationException>(
            () => sender.SendAsync("customer@example.com", "Your code", "<p>123456</p>"));
    }

    [Fact]
    public async Task SendAsync_PostsToTheResendApi_WithBearerAuth()
    {
        var (sender, handler) = MakeSender(_ => new HttpResponseMessage(HttpStatusCode.OK)
        {
            Content = new StringContent("""{"id":"email_123"}"""),
        });

        await sender.SendAsync("customer@example.com", "Your code", "<p>123456</p>");

        handler.LastRequest!.RequestUri.ShouldBe(new Uri("https://api.resend.com/emails"));
        handler.LastRequest.Method.ShouldBe(HttpMethod.Post);
        handler.LastRequest.Headers.Authorization.ShouldBe(new AuthenticationHeaderValue("Bearer", "re_test_key"));
    }

    /// <summary>The whole point of a dedicated sending subdomain: a customer who hits reply on an
    /// OTP email must land in the real, human-read mailbox rather than one nobody checks.</summary>
    [Fact]
    public async Task SendAsync_SendsFromTheNotificationsSubdomain_AndRepliesToTheRealMailbox()
    {
        var (sender, handler) = MakeSender(_ => new HttpResponseMessage(HttpStatusCode.OK)
        {
            Content = new StringContent("""{"id":"email_123"}"""),
        });

        await sender.SendAsync("customer@example.com", "Your code", "<p>123456</p>");

        using var payload = JsonDocument.Parse(handler.LastBody!);
        var root = payload.RootElement;
        root.GetProperty("from").GetString().ShouldBe("Ojas <wecare@notifications.ojasaata.com>");
        root.GetProperty("to")[0].GetString().ShouldBe("customer@example.com");
        root.GetProperty("subject").GetString().ShouldBe("Your code");
        root.GetProperty("html").GetString().ShouldBe("<p>123456</p>");
        root.GetProperty("reply_to").GetString().ShouldBe("wecare@ojasaata.com");
    }

    [Fact]
    public async Task SendAsync_OmitsReplyTo_WhenNotConfigured()
    {
        var (sender, handler) = MakeSender(_ => new HttpResponseMessage(HttpStatusCode.OK)
        {
            Content = new StringContent("""{"id":"email_123"}"""),
        }, ConfiguredSettings(replyTo: null));

        await sender.SendAsync("customer@example.com", "Your code", "<p>123456</p>");

        using var payload = JsonDocument.Parse(handler.LastBody!);
        payload.RootElement.TryGetProperty("reply_to", out _).ShouldBeFalse();
    }

    /// <summary>A bad key or an unverified sender must surface as a real exception - every OTP
    /// caller already catches this and degrades gracefully, but silently swallowing it here would
    /// mean nobody ever finds out delivery is broken.</summary>
    [Fact]
    public async Task SendAsync_ThrowsWithTheResendErrorBody_OnFailure()
    {
        var (sender, _) = MakeSender(_ => new HttpResponseMessage(HttpStatusCode.Unauthorized)
        {
            Content = new StringContent("""{"message":"API key is invalid"}"""),
        });

        var ex = await Should.ThrowAsync<InvalidOperationException>(
            () => sender.SendAsync("customer@example.com", "Your code", "<p>123456</p>"));

        ex.Message.ShouldContain("API key is invalid");
    }
}
