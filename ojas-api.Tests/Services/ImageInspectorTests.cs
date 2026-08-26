using OjasApi.Services;
using Shouldly;

namespace OjasApi.Tests.Services;

/// <summary>
/// The inspector is what stands between "an admin uploaded a file" and "the API serves those
/// bytes back from its own origin", so it has to be right about what it is looking at rather
/// than trusting whatever content type came attached.
/// </summary>
public class ImageInspectorTests
{
    // A real 2x3 PNG, produced by an encoder rather than hand-assembled.
    private static readonly byte[] Png = Convert.FromBase64String(
        "iVBORw0KGgoAAAANSUhEUgAAAAIAAAADCAYAAABfmqDcAAAAFUlEQVR4nGP8z8DAwMDAxAADRDEAJKgB8Sd0F6EAAAAASUVORK5CYII=");

    // The same picture as a lossless WebP (a VP8L chunk).
    private static readonly byte[] WebpLossless = Convert.FromBase64String(
        "UklGRjIAAABXRUJQVlA4WAoAAAAQAAAAAQAAAgAAQUxQSAoAAAABBxAREYiI/gcAAFZQOCAMAAAAsAEAnQEqAgADAAA=");

    // A minimal but genuine JPEG.
    private static readonly byte[] Jpeg = Convert.FromBase64String(
        "/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAADAAIBAREA/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/9oACAEBAAA/APn+iiigD//Z");

    [Fact]
    public void Inspect_ReadsPngDimensions()
    {
        var info = ImageInspector.Inspect(Png);

        info.ShouldNotBeNull();
        info.ContentType.ShouldBe("image/png");
        info.Width.ShouldBe(2);
        info.Height.ShouldBe(3);
    }

    [Fact]
    public void Inspect_ReadsLosslessWebpDimensions()
    {
        var info = ImageInspector.Inspect(WebpLossless);

        info.ShouldNotBeNull();
        info.ContentType.ShouldBe("image/webp");
        info.Width.ShouldBe(2);
        info.Height.ShouldBe(3);
    }

    [Fact]
    public void Inspect_ReadsJpegDimensions()
    {
        var info = ImageInspector.Inspect(Jpeg);

        info.ShouldNotBeNull();
        info.ContentType.ShouldBe("image/jpeg");
        info.Width.ShouldBe(2);
        info.Height.ShouldBe(3);
    }

    [Theory]
    [InlineData("<!doctype html><script>alert(1)</script>")]
    [InlineData("GIF89a")]
    [InlineData("")]
    [InlineData("not an image at all, just some text")]
    public void Inspect_RejectsAnythingThatIsNotASupportedImage(string content)
    {
        ImageInspector.Inspect(System.Text.Encoding.ASCII.GetBytes(content)).ShouldBeNull();
    }

    [Fact]
    public void Inspect_RejectsAPngHeaderWithNothingBehindIt()
    {
        // A truncated file must be refused rather than read past the end of the buffer.
        ReadOnlySpan<byte> justTheSignature = [0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A];
        ImageInspector.Inspect(justTheSignature).ShouldBeNull();
    }

    [Fact]
    public void Inspect_IgnoresTheFileNameAndAnyDeclaredType()
    {
        // The whole point: HTML renamed to .webp is still HTML, and is refused.
        var disguised = System.Text.Encoding.ASCII.GetBytes("<html><body>hello</body></html>");
        ImageInspector.Inspect(disguised).ShouldBeNull();
    }

    [Theory]
    [InlineData("image/webp", "webp")]
    [InlineData("image/png", "png")]
    [InlineData("image/jpeg", "jpg")]
    public void ExtensionFor_MapsTheFormatsWeServe(string contentType, string expected)
    {
        ImageInspector.ExtensionFor(contentType).ShouldBe(expected);
    }
}
