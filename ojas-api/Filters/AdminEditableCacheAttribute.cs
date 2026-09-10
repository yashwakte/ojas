using Microsoft.AspNetCore.Mvc.Filters;

namespace OjasApi.Filters;

/// <summary>
/// The cache policy for anything the owner edits in the admin console and customers read on the
/// storefront: the catalogue and its prices, campaign banners, hero slides and the delivery rules.
///
/// The browser never keeps its own copy, and Vercel's edge holds one for 15 seconds plus 45 of
/// background refresh - so an admin's edit reaches every customer within about a minute, while the
/// API still sees only a handful of requests a minute however busy the storefront is.
///
/// <para>These endpoints used to cache for minutes: a price change could take about twelve to reach
/// an anonymous visitor, and a new banner up to an hour, which is how a published banner stayed
/// invisible in the owner's normal tab while an incognito window showed it. The owner checks the
/// storefront the moment they save, and an edit that has not appeared when they look reads as a
/// save that failed. Any new admin-editable endpoint should use this attribute rather than
/// inventing numbers of its own.</para>
/// </summary>
[AttributeUsage(AttributeTargets.Method)]
public sealed class AdminEditableCacheAttribute : ActionFilterAttribute
{
    public const int EdgeFreshSeconds = 15;
    public const int EdgeRefreshSeconds = 45;

    private static readonly PublicCacheAttribute Policy = new(
        maxAgeSeconds: 0,
        staleWhileRevalidateSeconds: EdgeRefreshSeconds,
        sharedMaxAgeSeconds: EdgeFreshSeconds);

    public override void OnActionExecuted(ActionExecutedContext context) => Policy.OnActionExecuted(context);
}
