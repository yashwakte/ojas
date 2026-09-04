using System.Globalization;
using System.Runtime.CompilerServices;
using Microsoft.Extensions.Configuration;
using OjasApi.Models;
using OjasApi.Services;
using Shouldly;

namespace OjasApi.Tests.Services;

/// <summary>
/// Drives the real <see cref="CashfreeService"/> against the real sandbox, with the real
/// configuration, under the machine's real locale.
///
/// Deliberately not part of the normal suite — it needs network and live credentials. It exists
/// because a hand-built payload sent from a shell is *not* a test of the code that runs in
/// production, and trusting one is how a locale-dependent format string reached a running server
/// and broke every checkout.
///
/// Run it on demand:
///     dotnet test --filter "FullyQualifiedName~CashfreeLiveSandboxCheck"
/// </summary>
public class CashfreeLiveSandboxCheck
{
    /// <summary>
    /// The repo's own dev config, located from this source file's compile-time path rather than
    /// from the build output.
    ///
    /// Anchoring it to the output directory is what made the first version of this check pass in
    /// thirteen milliseconds without touching the network — it found nothing, returned early, and
    /// reported success. A check that cannot tell "everything works" from "I did nothing" is worse
    /// than no check, and that is the same mistake, in miniature, that let the locale bug ship.
    /// </summary>
    private static string? FindDevelopmentConfig([CallerFilePath] string thisFile = "")
    {
        // <repo>/ojas-api.Tests/Services/ThisFile.cs -> <repo>
        var repoRoot = Path.GetFullPath(Path.Combine(Path.GetDirectoryName(thisFile)!, "..", ".."));
        var candidate = Path.Combine(repoRoot, "ojas-api", "appsettings.Development.json");
        return File.Exists(candidate) ? candidate : null;
    }

    /// <summary>Passes the request through untouched, keeping a copy of the body so a rejection
    /// can say what was actually sent rather than what the source suggests was sent.</summary>
    private sealed class PayloadSpy : DelegatingHandler
    {
        public string? LastBody { get; private set; }

        public PayloadSpy() : base(new HttpClientHandler()) { }

        protected override async Task<HttpResponseMessage> SendAsync(
            HttpRequestMessage request, CancellationToken cancellationToken)
        {
            if (request.Content is not null)
                LastBody = await request.Content.ReadAsStringAsync(cancellationToken);

            return await base.SendAsync(request, cancellationToken);
        }
    }

    [Fact]
    public async Task TheRealCodePath_CreatesAnOrderCashfreeAccepts()
    {
        var path = FindDevelopmentConfig();
        if (path is null) return; // Not a developer machine — nothing to check.

        var config = new ConfigurationBuilder().AddJsonFile(path).Build();
        // Says out loud that it found real credentials, so a silent no-op cannot masquerade as a
        // passing check the way it did the first time this was run.
        config["Cashfree:ClientId"].ShouldNotBeNullOrWhiteSpace(
            $"No Cashfree credentials in {path} - this check proved nothing.");

        // Under the locale that actually broke this. en-IN's time separator is '.', which turned
        // an unescaped "HH:mm:ss" into "18.00.33" and had Cashfree reject every order.
        var original = CultureInfo.CurrentCulture;
        CultureInfo.CurrentCulture = new CultureInfo("en-IN");
        try
        {
            // Surfaced in the failure message: when Cashfree rejects this, the first question is
            // always "what did we actually send", and guessing at it is what wasted a round trip.
            var expiry = CashfreeService.FormatExpiry(DateTimeOffset.UtcNow.Add(CashfreeService.PaymentWindow));
            expiry.ShouldMatch(
                @"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$",
                $"order_expiry_time was '{expiry}'");

            // Captures the exact bytes on the wire. Inferring the payload from the source is what
            // sent this investigation down a wrong path once already.
            var spy = new PayloadSpy();
            var service = new CashfreeService(new HttpClient(spy), config);
            var order = new Order
            {
                Id = "live" + DateTime.UtcNow.ToString("yyyyMMddHHmmssfff", CultureInfo.InvariantCulture),
                UserId = "live-check-user",
                FullName = "Live Check",
                Phone = "9123456789",
                Address = "123 Main St",
                TotalAmount = 1m,
                Items = [],
            };

            CashfreeOrderResult result;
            try
            {
                result = await service.CreateOrderAsync(order);
            }
            catch (Exception ex)
            {
                throw new Exception(
                    $"Cashfree refused the payload the real code builds.\nSENT: {spy.LastBody}\n{ex.Message}", ex);
            }

            result.PaymentSessionId.ShouldNotBeNullOrWhiteSpace();

            // And the order comes back readable, which is what every payment decision rests on.
            var lookup = await service.LookUpAsync(order.Id);
            lookup.Reachable.ShouldBeTrue();
            lookup.Order!.IsOpen.ShouldBeTrue();
            lookup.Payments.ShouldBeEmpty();
            lookup.OpenAndUnattempted.ShouldBeTrue();
        }
        finally
        {
            CultureInfo.CurrentCulture = original;
        }
    }
}
