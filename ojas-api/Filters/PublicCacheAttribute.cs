using Microsoft.AspNetCore.Mvc.Filters;

namespace OjasApi.Filters;

/// <summary>
/// Marks a read-only endpoint whose response is the same for everybody, so caches in front of
/// the API may answer it without asking us.
///
/// The catalog and the campaign banners are read on effectively every page view and change a
/// handful of times a week. Serving each of those reads from the origin is pure waste; a short
/// <c>max-age</c> paired with a long <c>stale-while-revalidate</c> means a cache answers
/// instantly from what it has and refreshes in the background, so nobody ever waits on us -
/// including during a cold start on the API instance.
///
/// <para><b>The one thing that must not go wrong here</b> is caching a response that was
/// personalised. Authenticated responses carry the X-Ojas-User header naming the caller's
/// account, and a shared cache storing one of those would hand another customer's identity to
/// the next visitor. So the public headers are only ever set for anonymous requests; a signed-in
/// caller is explicitly told <c>no-store</c> instead. That does mean signed-in customers skip
/// the cache on these endpoints, which is the correct trade: they are a small share of traffic
/// and correctness is not negotiable.</para>
/// </summary>
[AttributeUsage(AttributeTargets.Method)]
public sealed class PublicCacheAttribute : ActionFilterAttribute
{
    private readonly int _maxAgeSeconds;
    private readonly int _staleWhileRevalidateSeconds;

    public PublicCacheAttribute(int maxAgeSeconds, int staleWhileRevalidateSeconds)
    {
        _maxAgeSeconds = maxAgeSeconds;
        _staleWhileRevalidateSeconds = staleWhileRevalidateSeconds;
    }

    public override void OnActionExecuted(ActionExecutedContext context)
    {
        var response = context.HttpContext.Response;

        if (context.Exception != null || response.StatusCode is < 200 or >= 300)
            return;

        if (context.HttpContext.User?.Identity?.IsAuthenticated == true)
        {
            response.Headers.CacheControl = "private, no-store";
            return;
        }

        response.Headers.CacheControl =
            $"public, max-age={_maxAgeSeconds}, stale-while-revalidate={_staleWhileRevalidateSeconds}";

        // Appended, never assigned. CORS puts "Origin" in Vary on cross-origin responses, and
        // overwriting that on a response we have just made publicly cacheable would let a shared
        // cache hand one origin's Access-Control-Allow-Origin header to a different origin.
        response.Headers.Append("Vary", "Accept-Encoding");
    }
}
