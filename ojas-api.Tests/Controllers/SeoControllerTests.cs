using System.Xml.Linq;
using OjasApi.Controllers;
using OjasApi.Models;
using Shouldly;

namespace OjasApi.Tests.Controllers;

public class SeoControllerTests
{
    private const string Site = "https://www.ojasaata.com";
    private static readonly XNamespace Sm = "http://www.sitemaps.org/schemas/sitemap/0.9";
    private static readonly XNamespace Img = "http://www.google.com/schemas/sitemap-image/1.1";

    private static Product Make(
        string name,
        string? slug,
        string category = "Everyday Flours",
        string imageUrl = "/images/test-front.webp",
        List<string>? gallery = null,
        DateTime? updatedAt = null) => new()
    {
        Name = name,
        Slug = slug,
        Description = "Test product",
        Price = 50m,
        Category = category,
        Weight = "500g",
        ImageUrl = imageUrl,
        GalleryImageUrls = gallery ?? [],
        UpdatedAt = updatedAt ?? new DateTime(2026, 9, 4, 20, 2, 0, DateTimeKind.Utc),
    };

    private static List<XElement> Urls(string xml) =>
        XDocument.Parse(xml).Root!.Elements(Sm + "url").ToList();

    private static XElement? UrlFor(string xml, string loc) =>
        Urls(xml).SingleOrDefault(u => u.Element(Sm + "loc")!.Value == loc);

    [Fact]
    public void ListsTheShopsOwnPages_AndNotTheAccountOnes()
    {
        var xml = SeoController.BuildSitemap([], Site);

        var locs = Urls(xml).Select(u => u.Element(Sm + "loc")!.Value).ToList();
        locs.ShouldContain($"{Site}/");
        locs.ShouldContain($"{Site}/products");
        locs.ShouldContain($"{Site}/refunds");
        locs.ShouldNotContain(l => l.Contains("/cart") || l.Contains("/checkout") || l.Contains("/login"));
    }

    [Fact]
    public void GivesEachProductItsReadableAddress_WithItsPhotos()
    {
        var xml = SeoController.BuildSitemap(
            [Make("Modak Pith", "modak-pith", "Traditional & Festive", "/images/modak-pith-front.webp", ["/images/modak-pith-back.webp"])],
            Site);

        var url = UrlFor(xml, $"{Site}/products/modak-pith");
        url.ShouldNotBeNull();
        url.Element(Sm + "lastmod")!.Value.ShouldBe("2026-09-04T20:02:00Z");
        url.Descendants(Img + "loc").Select(e => e.Value).ShouldBe(
        [
            $"{Site}/images/modak-pith-front.webp",
            $"{Site}/images/modak-pith-back.webp",
        ]);
    }

    [Fact]
    public void OpensAnAisle_OnlyWhenSomethingIsInIt()
    {
        var xml = SeoController.BuildSitemap([Make("Modak Pith", "modak-pith", "Traditional & Festive")], Site);

        UrlFor(xml, $"{Site}/products?category=Traditional%20%26%20Festive").ShouldNotBeNull();
        UrlFor(xml, $"{Site}/products?category=Upwas").ShouldBeNull();
    }

    [Fact]
    public void LeavesOutAisleNamesTheShopWouldNotOpen()
    {
        // The storefront renders the unfiltered shop for any category it does not know, so an
        // address for one would be a duplicate of /products.
        var xml = SeoController.BuildSitemap([Make("Mystery Mix", "mystery-mix", "Powder Box")], Site);

        xml.ShouldNotContain("category=Powder");
    }

    [Fact]
    public void SkipsAProductThatHasNoAddressYet()
    {
        var xml = SeoController.BuildSitemap([Make("Brand New Pack", slug: null)], Site);

        xml.ShouldNotContain("brand-new-pack");
        xml.ShouldNotContain("/products/");
    }

    [Fact]
    public void KeepsOnlyPhotosThatHaveAnAddress()
    {
        var xml = SeoController.BuildSitemap(
            [Make("Ragi Flour", "ragi-flour", imageUrl: "data:image/webp;base64,AAAA", gallery: ["https://cdn.example.com/ragi.webp", "/api/media/abc"])],
            Site);

        UrlFor(xml, $"{Site}/products/ragi-flour")!
            .Descendants(Img + "loc").Select(e => e.Value)
            .ShouldBe(["https://cdn.example.com/ragi.webp", $"{Site}/api/media/abc"]);
    }

    [Fact]
    public void DatesTheShopByItsMostRecentlyChangedProduct_AndThePoliciesNotAtAll()
    {
        var xml = SeoController.BuildSitemap(
            [
                Make("Old", "old", updatedAt: new DateTime(2026, 8, 1, 0, 0, 0, DateTimeKind.Utc)),
                Make("New", "new", updatedAt: new DateTime(2026, 9, 10, 6, 30, 0, DateTimeKind.Utc)),
            ],
            Site);

        UrlFor(xml, $"{Site}/products")!.Element(Sm + "lastmod")!.Value.ShouldBe("2026-09-10T06:30:00Z");
        UrlFor(xml, $"{Site}/privacy")!.Element(Sm + "lastmod").ShouldBeNull();
    }
}
