using System.Globalization;
using System.Text;
using System.Text.RegularExpressions;

namespace OjasApi.Services;

/// <summary>
/// The readable half of a product's web address: "Modak Pith" lives at /products/modak-pith.
///
/// Product pages used to be addressed by their database id (/products/69db536f…), which tells a
/// search engine nothing and a customer reading a shared link even less. The words in an address
/// are a small ranking signal and a large trust signal — a link that says what it is gets clicked.
/// </summary>
public static class ProductSlug
{
    /// <summary>
    /// Path segments the products API already answers itself. A product slugged to one of these
    /// could never be reached, because the literal route wins, so it is pushed off them instead.
    /// </summary>
    private static readonly HashSet<string> Reserved = new(StringComparer.Ordinal)
    {
        "bestsellers",
        "low-stock",
        "category",
    };

    private const int MaxLength = 80;

    private static readonly Regex NonAlphanumeric = new(
        "[^a-z0-9]+", RegexOptions.Compiled, TimeSpan.FromMilliseconds(100));

    /// <summary>
    /// Lower-case ASCII words joined by hyphens: "Rajgira (Amaranth) Flour" becomes
    /// "rajgira-amaranth-flour". Accents are folded rather than dropped, so "Crème" reads "creme".
    /// A name with no Latin letters at all — one typed only in Devanagari — falls back to
    /// "product", and the caller's uniqueness step numbers it.
    /// </summary>
    public static string From(string name)
    {
        var decomposed = (name ?? string.Empty).Normalize(NormalizationForm.FormD);
        var folded = new StringBuilder(decomposed.Length);
        foreach (var c in decomposed)
        {
            if (CharUnicodeInfo.GetUnicodeCategory(c) == UnicodeCategory.NonSpacingMark) continue;
            folded.Append(char.ToLowerInvariant(c));
        }

        var slug = NonAlphanumeric.Replace(folded.ToString(), "-").Trim('-');
        if (slug.Length > MaxLength) slug = slug[..MaxLength].TrimEnd('-');
        if (slug.Length == 0) slug = "product";
        return Reserved.Contains(slug) ? $"{slug}-product" : slug;
    }

    /// <summary>
    /// The first of <paramref name="baseSlug"/>, baseSlug-2, baseSlug-3… that no other product
    /// holds. Two packs of the same name in different sizes are the realistic case.
    /// </summary>
    public static string Unique(string baseSlug, IReadOnlySet<string> taken)
    {
        if (!taken.Contains(baseSlug)) return baseSlug;
        for (var n = 2; ; n++)
        {
            var candidate = $"{baseSlug}-{n}";
            if (!taken.Contains(candidate)) return candidate;
        }
    }
}
