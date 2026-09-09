namespace OjasApi.Configuration;

/// <summary>
/// Decides which browser origins the production CORS policy will trust.
///
/// The site is served from ojasaata.com. The hosting platform's own <c>*.vercel.app</c> addresses
/// are not an origin we serve to anybody any more, and they are refused unconditionally rather
/// than merely left out of the allow-list: anyone at all can deploy a page to one of those
/// addresses, and this policy sends credentials, so a single stale entry - in a config file, or in
/// an environment variable nobody cleaned up on the host - would be enough to hand a stranger's
/// page a signed-in customer's orders, wallet and profile out of their own browser.
/// </summary>
public static class CorsOriginPolicy
{
    /// <summary>Origins the API trusts when <c>Cors:AllowedOrigins</c> says nothing. Browsers
    /// normally reach the API same-origin through the hosting rewrite, so CORS is not on the
    /// ordinary path at all - this is the backstop for anything calling the API host directly.</summary>
    public static readonly string[] Defaults = ["https://ojasaata.com", "https://www.ojasaata.com"];

    /// <summary>True for an origin on the hosting platform's own preview/alias domain.</summary>
    public static bool IsVercelOrigin(string? origin) =>
        Uri.TryCreate(origin, UriKind.Absolute, out var uri)
        && uri.Host.EndsWith(".vercel.app", StringComparison.OrdinalIgnoreCase);

    /// <summary>
    /// The configured origins with every <c>*.vercel.app</c> entry removed. Dropping them here -
    /// rather than throwing at startup - is deliberate: a deploy that refuses to boot over a
    /// leftover setting is worse than one that quietly stops trusting it, and the caller logs
    /// exactly what was ignored.
    /// </summary>
    public static string[] Sanitize(IEnumerable<string>? configured)
    {
        var kept = (configured ?? Defaults)
            .Where(origin => !string.IsNullOrWhiteSpace(origin) && !IsVercelOrigin(origin))
            .ToArray();

        // A deployment whose whole configured list was the old host would otherwise be left
        // trusting no origin at all, which breaks any direct call to the API host rather than
        // just the one that had to stop working. Fall back to the real domain instead.
        return kept.Length > 0 ? kept : Defaults;
    }

    /// <summary>Whether a request's Origin header is allowed by the production policy.</summary>
    public static bool IsAllowed(string origin, IReadOnlyCollection<string> allowedOrigins) =>
        !IsVercelOrigin(origin)
        && allowedOrigins.Contains(origin, StringComparer.OrdinalIgnoreCase);
}
