using OjasApi.Services;
using Shouldly;

namespace OjasApi.Tests.Services;

public class ProductSlugTests
{
    [Theory]
    [InlineData("Modak Pith", "modak-pith")]
    [InlineData("Rajgira (Amaranth) Flour", "rajgira-amaranth-flour")]
    [InlineData("Custard Powder - Vanilla Flavour", "custard-powder-vanilla-flavour")]
    [InlineData("Ragi Malt (Sprouted)", "ragi-malt-sprouted")]
    [InlineData("  Bhagar (Varai) Peeth  ", "bhagar-varai-peeth")]
    [InlineData("Crème Brûlée Mix", "creme-brulee-mix")]
    public void From_TurnsAProductNameIntoLowerCaseHyphenatedWords(string name, string expected)
    {
        ProductSlug.From(name).ShouldBe(expected);
    }

    [Fact]
    public void From_FallsBackToProduct_WhenTheNameHasNoLatinLetters()
    {
        ProductSlug.From("मोदक पीठ").ShouldBe("product");
    }

    [Theory]
    [InlineData("Bestsellers", "bestsellers-product")]
    [InlineData("Low Stock", "low-stock-product")]
    [InlineData("Category", "category-product")]
    public void From_StepsOffTheApisOwnRouteNames(string name, string expected)
    {
        // /api/products/bestsellers is a route of its own; a product slugged to it could never be
        // fetched.
        ProductSlug.From(name).ShouldBe(expected);
    }

    [Fact]
    public void From_CapsTheLength_WithoutLeavingATrailingHyphen()
    {
        var slug = ProductSlug.From(string.Join(' ', Enumerable.Repeat("stone ground", 20)));

        slug.Length.ShouldBeLessThanOrEqualTo(80);
        slug.ShouldNotEndWith("-");
    }

    [Fact]
    public void Unique_ReturnsTheBase_WhenNobodyHasIt()
    {
        ProductSlug.Unique("rice-flour", new HashSet<string> { "modak-pith" }).ShouldBe("rice-flour");
    }

    [Fact]
    public void Unique_NumbersTheAddress_WhenItIsTaken()
    {
        var taken = new HashSet<string> { "rice-flour", "rice-flour-2" };

        ProductSlug.Unique("rice-flour", taken).ShouldBe("rice-flour-3");
    }
}
