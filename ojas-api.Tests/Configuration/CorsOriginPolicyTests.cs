using OjasApi.Configuration;
using Shouldly;

namespace OjasApi.Tests.Configuration;

/// <summary>
/// The site moved to ojasaata.com, and *.vercel.app is no longer an origin we serve to anybody.
/// Because the production policy sends credentials, trusting one of those addresses again would
/// let any page deployed there read a signed-in customer's orders, wallet and profile - so the
/// refusal is pinned here rather than left to whatever configuration happens to be deployed.
/// </summary>
public class CorsOriginPolicyTests
{
    [Fact]
    public void Defaults_are_the_custom_domain_only()
    {
        CorsOriginPolicy.Defaults.ShouldBe(["https://ojasaata.com", "https://www.ojasaata.com"]);
    }

    [Theory]
    [InlineData("https://ojas-atta.vercel.app")]
    [InlineData("https://anything.vercel.app")]
    [InlineData("https://OJAS-ATTA.VERCEL.APP")]
    [InlineData("http://ojas-atta.vercel.app")]
    public void Vercel_origins_are_recognised(string origin)
    {
        CorsOriginPolicy.IsVercelOrigin(origin).ShouldBeTrue();
    }

    [Theory]
    [InlineData("https://ojasaata.com")]
    [InlineData("https://vercel.app.evil.com")]
    [InlineData("https://notvercel.app")]
    [InlineData("not a url")]
    [InlineData(null)]
    public void Other_origins_are_not_mistaken_for_vercel(string? origin)
    {
        CorsOriginPolicy.IsVercelOrigin(origin).ShouldBeFalse();
    }

    [Fact]
    public void Sanitize_drops_configured_vercel_origins_and_keeps_the_rest()
    {
        var kept = CorsOriginPolicy.Sanitize(
            ["https://ojasaata.com", "https://ojas-atta.vercel.app", "  ", "https://www.ojasaata.com"]);

        kept.ShouldBe(["https://ojasaata.com", "https://www.ojasaata.com"]);
    }

    [Fact]
    public void Sanitize_falls_back_to_the_defaults_when_nothing_is_configured()
    {
        CorsOriginPolicy.Sanitize(null).ShouldBe(CorsOriginPolicy.Defaults);
    }

    [Fact]
    public void Sanitize_falls_back_to_the_defaults_rather_than_trusting_nothing()
    {
        // A host still configured with only the old *.vercel.app origin would otherwise be left
        // with an empty allow-list, breaking every direct call to the API rather than just that one.
        CorsOriginPolicy.Sanitize(["https://ojas-atta.vercel.app"]).ShouldBe(CorsOriginPolicy.Defaults);
    }

    [Fact]
    public void A_vercel_origin_is_refused_even_if_it_somehow_reaches_the_allow_list()
    {
        CorsOriginPolicy
            .IsAllowed("https://ojas-atta.vercel.app", ["https://ojas-atta.vercel.app"])
            .ShouldBeFalse();
    }

    [Fact]
    public void The_custom_domain_is_allowed_and_strangers_are_not()
    {
        var allowed = CorsOriginPolicy.Sanitize(null);

        CorsOriginPolicy.IsAllowed("https://ojasaata.com", allowed).ShouldBeTrue();
        CorsOriginPolicy.IsAllowed("https://WWW.OJASAATA.COM", allowed).ShouldBeTrue();
        CorsOriginPolicy.IsAllowed("https://evil.example", allowed).ShouldBeFalse();
    }
}
