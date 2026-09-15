using System.Globalization;
using System.Text;
using System.Xml;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.RateLimiting;
using OjasApi.Filters;
using OjasApi.Models;
using OjasApi.Services;

namespace OjasApi.Controllers;

/// <summary>
/// What search engines are told about the shop. The sitemap is served to them at
/// www.ojasaata.com/sitemap.xml, through a rewrite in the storefront's vercel.json.
///
/// Built from the live catalogue rather than written by hand, because a sitemap that has to be
/// remembered is a sitemap that goes stale: every product the owner lists appears in it on its
/// own, and an unlisted one never does.
/// </summary>
[ApiController]
[Route("api/seo")]
[EnableRateLimiting("general")]
public class SeoController : ControllerBase
{
    /// <summary>
    /// The one address Google should know the shop by. The bare domain 308-redirects here, so
    /// listing that form would ask Google to crawl a redirect for every page. Overridable with
    /// Seo:SiteUrl for a staging copy.
    /// </summary>
    public const string DefaultSiteUrl = "https://www.ojasaata.com";

    /// <summary>
    /// The storefront pages worth a search result on their own. Sign-in, cart, checkout and the
    /// account pages are left out on purpose — robots.txt keeps crawlers off them.
    /// </summary>
    internal static readonly string[] StaticPaths =
        ["/", "/products", "/offers", "/about", "/contact", "/refunds", "/terms", "/privacy"];

    /// <summary>
    /// The aisles, in shop order. Mirrors PRODUCT_CATEGORIES on the storefront, which only opens a
    /// category page for one of these — any other value would render the unfiltered shop.
    /// </summary>
    internal static readonly string[] Categories =
    [
        "Everyday Flours",
        "Traditional & Festive",
        "Upwas",
        "Health & Breakfast",
        "Baking & Desserts",
        "Spices & Essentials",
    ];

    private const string SitemapNs = "http://www.sitemaps.org/schemas/sitemap/0.9";
    private const string ImageNs = "http://www.google.com/schemas/sitemap-image/1.1";

    private readonly ProductService _products;
    private readonly string _siteUrl;

    public SeoController(ProductService products, IConfiguration configuration)
    {
        _products = products;
        _siteUrl = (configuration["Seo:SiteUrl"] ?? DefaultSiteUrl).TrimEnd('/');
    }

    /// <summary>
    /// Held at Vercel's edge for an hour and served from there for up to a day while it refreshes,
    /// so a crawler never waits on this instance waking up. Nothing here is urgent: Google reads a
    /// sitemap every few days at most, and a new product is found through the shop's own links
    /// long before that.
    /// </summary>
    [HttpGet("sitemap.xml")]
    [PublicCache(maxAgeSeconds: 0, staleWhileRevalidateSeconds: 86_400, sharedMaxAgeSeconds: 3_600)]
    public async Task<IActionResult> Sitemap()
    {
        var listed = await _products.GetAllAsync();
        return Content(BuildSitemap(listed, _siteUrl), "application/xml; charset=utf-8");
    }

    internal static string BuildSitemap(IReadOnlyCollection<Product> listedProducts, string siteUrl)
    {
        var products = listedProducts
            .Where(p => !string.IsNullOrEmpty(p.Slug))
            .OrderBy(p => p.Name, StringComparer.OrdinalIgnoreCase)
            .ToList();
        DateTime? catalogueUpdated = products.Count > 0 ? products.Max(p => p.UpdatedAt) : null;

        using var stream = new MemoryStream();
        var settings = new XmlWriterSettings { Encoding = new UTF8Encoding(false), Indent = true };
        using (var xml = XmlWriter.Create(stream, settings))
        {
            xml.WriteStartDocument();
            xml.WriteStartElement("urlset", SitemapNs);
            xml.WriteAttributeString("xmlns", "image", null, ImageNs);

            foreach (var path in StaticPaths)
            {
                // The home page and the shop change whenever the catalogue does; the policy pages
                // carry no date, since a guessed one is worse than none — Google stops trusting
                // lastmod on a site where it is wrong.
                var lastModified = path is "/" or "/products" ? catalogueUpdated : null;
                WriteUrl(xml, siteUrl + path, lastModified);
            }

            foreach (var category in Categories)
            {
                var inAisle = products.Where(p => p.Category == category).ToList();
                if (inAisle.Count == 0) continue;
                WriteUrl(
                    xml,
                    $"{siteUrl}/products?category={Uri.EscapeDataString(category)}",
                    inAisle.Max(p => p.UpdatedAt));
            }

            foreach (var product in products)
            {
                WriteUrl(
                    xml,
                    $"{siteUrl}/products/{product.Slug}",
                    product.UpdatedAt,
                    [product.ImageUrl, .. product.GalleryImageUrls]);
            }

            xml.WriteEndElement();
            xml.WriteEndDocument();
        }

        return Encoding.UTF8.GetString(stream.ToArray());

        void WriteUrl(XmlWriter xml, string loc, DateTime? lastModified, IEnumerable<string>? images = null)
        {
            xml.WriteStartElement("url", SitemapNs);
            xml.WriteElementString("loc", SitemapNs, loc);
            if (lastModified is { } when)
            {
                xml.WriteElementString(
                    "lastmod",
                    SitemapNs,
                    when.ToUniversalTime().ToString("yyyy-MM-dd'T'HH:mm:ss'Z'", CultureInfo.InvariantCulture));
            }

            foreach (var image in (images ?? []).Select(url => AbsoluteImageUrl(url, siteUrl)).OfType<string>().Distinct())
            {
                xml.WriteStartElement("image", "image", ImageNs);
                xml.WriteElementString("image", "loc", ImageNs, image);
                xml.WriteEndElement();
            }

            xml.WriteEndElement();
        }
    }

    /// <summary>
    /// Pack shots are stored as site-relative paths (/images/…, or /api/media/… for an admin
    /// upload), which a sitemap cannot use. An inline data: image has no address to give at all.
    /// </summary>
    private static string? AbsoluteImageUrl(string? url, string siteUrl)
    {
        if (string.IsNullOrWhiteSpace(url)) return null;
        if (url.StartsWith("https://", StringComparison.OrdinalIgnoreCase)) return url;
        return url.StartsWith('/') ? siteUrl + url : null;
    }
}
