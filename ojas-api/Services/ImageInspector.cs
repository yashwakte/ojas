namespace OjasApi.Services;

/// <summary>What a byte array actually is, as opposed to what its uploader claimed.</summary>
public sealed record ImageInfo(string ContentType, int Width, int Height);

/// <summary>
/// Identifies an image from its own bytes and reads its pixel dimensions.
///
/// Two reasons this exists rather than trusting the upload's declared content type:
///
/// 1. <b>Safety.</b> A browser will happily post <c>Content-Type: image/webp</c> attached to an
///    HTML file, and we then serve those bytes back from our own origin. Sniffing the real
///    format and echoing *that* back - never the caller's claim - is what stops a stored file
///    from being interpreted as anything but a picture.
/// 2. <b>Layout stability.</b> Knowing width and height lets the storefront reserve exactly the
///    right box before the image arrives, so nothing on the page jumps as pictures load.
///
/// Only the formats we actually serve are accepted; anything else is refused outright rather
/// than stored and puzzled over later.
/// </summary>
public static class ImageInspector
{
    /// <summary>Returns null when the bytes are not a supported image.</summary>
    public static ImageInfo? Inspect(ReadOnlySpan<byte> bytes)
    {
        if (TryPng(bytes, out var png)) return png;
        if (TryWebp(bytes, out var webp)) return webp;
        if (TryJpeg(bytes, out var jpeg)) return jpeg;
        return null;
    }

    public static string ExtensionFor(string contentType) => contentType switch
    {
        "image/webp" => "webp",
        "image/png" => "png",
        "image/jpeg" => "jpg",
        _ => "bin",
    };

    private static bool TryPng(ReadOnlySpan<byte> b, out ImageInfo? info)
    {
        info = null;
        ReadOnlySpan<byte> signature = [0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A];
        // IHDR is mandated to be the first chunk, so the dimensions are always at 16..23.
        if (b.Length < 24 || !b[..8].SequenceEqual(signature)) return false;
        info = new ImageInfo("image/png", ReadBe32(b, 16), ReadBe32(b, 20));
        return true;
    }

    private static bool TryWebp(ReadOnlySpan<byte> b, out ImageInfo? info)
    {
        info = null;
        if (b.Length < 30) return false;
        if (b[0] != 'R' || b[1] != 'I' || b[2] != 'F' || b[3] != 'F') return false;
        if (b[8] != 'W' || b[9] != 'E' || b[10] != 'B' || b[11] != 'P') return false;

        // Three container flavours, each storing the canvas size somewhere different.
        var chunk = System.Text.Encoding.ASCII.GetString(b.Slice(12, 4));
        switch (chunk)
        {
            case "VP8 ":
                // Lossy: 3-byte frame tag, then the 9D 01 2A sync code, then 14-bit LE dimensions.
                if (b[23] != 0x9D || b[24] != 0x01 || b[25] != 0x2A) return false;
                info = new ImageInfo("image/webp", ReadLe16(b, 26) & 0x3FFF, ReadLe16(b, 28) & 0x3FFF);
                return true;
            case "VP8L":
                // Lossless: one signature byte, then width-1 and height-1 packed as 14 bits each.
                if (b[20] != 0x2F) return false;
                var packed = (uint)(b[21] | (b[22] << 8) | (b[23] << 16) | (b[24] << 24));
                info = new ImageInfo("image/webp", (int)(packed & 0x3FFF) + 1, (int)((packed >> 14) & 0x3FFF) + 1);
                return true;
            case "VP8X":
                // Extended (animation, alpha, ICC): canvas size as two 24-bit LE values, minus one.
                if (b.Length < 30) return false;
                info = new ImageInfo("image/webp", ReadLe24(b, 24) + 1, ReadLe24(b, 27) + 1);
                return true;
            default:
                return false;
        }
    }

    private static bool TryJpeg(ReadOnlySpan<byte> b, out ImageInfo? info)
    {
        info = null;
        if (b.Length < 4 || b[0] != 0xFF || b[1] != 0xD8) return false;

        // Walk the marker chain to the start-of-frame, which is the only segment carrying the
        // image size. Everything before it (EXIF, colour profiles, comments) is skipped by length.
        var i = 2;
        while (i + 3 < b.Length)
        {
            if (b[i] != 0xFF) { i++; continue; }

            var marker = b[i + 1];
            if (marker == 0xFF) { i++; continue; }                       // fill byte
            if (marker == 0x01 || (marker >= 0xD0 && marker <= 0xD9))    // standalone, no payload
            {
                i += 2;
                continue;
            }

            var length = ReadBe16(b, i + 2);
            if (length < 2) return false;

            var isStartOfFrame = marker is >= 0xC0 and <= 0xCF && marker != 0xC4 && marker != 0xC8 && marker != 0xCC;
            if (isStartOfFrame)
            {
                if (i + 9 > b.Length) return false;
                info = new ImageInfo("image/jpeg", ReadBe16(b, i + 7), ReadBe16(b, i + 5));
                return true;
            }

            i += 2 + length;
        }

        return false;
    }

    private static int ReadBe32(ReadOnlySpan<byte> b, int at) => (b[at] << 24) | (b[at + 1] << 16) | (b[at + 2] << 8) | b[at + 3];
    private static int ReadBe16(ReadOnlySpan<byte> b, int at) => (b[at] << 8) | b[at + 1];
    private static int ReadLe16(ReadOnlySpan<byte> b, int at) => b[at] | (b[at + 1] << 8);
    private static int ReadLe24(ReadOnlySpan<byte> b, int at) => b[at] | (b[at + 1] << 8) | (b[at + 2] << 16);
}
