namespace IdentityService.Api.Services;

// Cac quy tac chung cho avatar do client tai len va avatar lay tu OAuth.
// Kiem bang byte dau file, khong tin Content-Type do client/remote server gui.
public static class AvatarImage
{
    public const int MaxBytes = 256 * 1024;

    public static string? SniffMime(ReadOnlySpan<byte> bytes)
    {
        if (bytes.Length >= 8 && bytes[0] == 0x89 && bytes[1] == 0x50 && bytes[2] == 0x4E && bytes[3] == 0x47)
            return "image/png";
        if (bytes.Length >= 3 && bytes[0] == 0xFF && bytes[1] == 0xD8 && bytes[2] == 0xFF)
            return "image/jpeg";
        // WEBP: "RIFF" .... "WEBP"
        if (bytes.Length >= 12 && bytes[0] == 0x52 && bytes[1] == 0x49 && bytes[2] == 0x46 && bytes[3] == 0x46
            && bytes[8] == 0x57 && bytes[9] == 0x45 && bytes[10] == 0x42 && bytes[11] == 0x50)
            return "image/webp";
        return null;
    }
}

public record DownloadedAvatar(byte[] Bytes, string Mime);

// Avatar URL do Google userinfo tra ve la URL ben thu ba. Chi chap nhan HTTPS
// va googleusercontent.com, khong follow redirect, gioi han 256 KB: tranh
// OAuth tro thanh duong SSRF hoac lam cham/don day dung luong dang nhap.
public sealed class OAuthAvatarDownloader(IHttpClientFactory httpClientFactory, ILogger<OAuthAvatarDownloader> logger)
{
    public async Task<DownloadedAvatar?> TryDownloadGoogleAsync(string? value, CancellationToken cancellationToken)
    {
        if (!Uri.TryCreate(value, UriKind.Absolute, out var uri)
            || uri.Scheme != Uri.UriSchemeHttps
            || !(uri.Host.Equals("googleusercontent.com", StringComparison.OrdinalIgnoreCase)
                || uri.Host.EndsWith(".googleusercontent.com", StringComparison.OrdinalIgnoreCase)))
            return null;

        try
        {
            var client = httpClientFactory.CreateClient("GoogleAvatar");
            using var response = await client.GetAsync(uri, HttpCompletionOption.ResponseHeadersRead, cancellationToken);
            if (!response.IsSuccessStatusCode
                || response.Content.Headers.ContentLength is > AvatarImage.MaxBytes)
                return null;

            await using var source = await response.Content.ReadAsStreamAsync(cancellationToken);
            using var output = new MemoryStream();
            var buffer = new byte[16 * 1024];
            int read;
            while ((read = await source.ReadAsync(buffer, cancellationToken)) > 0)
            {
                output.Write(buffer, 0, read);
                if (output.Length > AvatarImage.MaxBytes)
                    return null;
            }

            var bytes = output.ToArray();
            var mime = AvatarImage.SniffMime(bytes);
            return mime is null ? null : new DownloadedAvatar(bytes, mime);
        }
        catch (Exception ex) when (ex is HttpRequestException or TaskCanceledException)
        {
            // Anh Google la phan phu: loi mang khong duoc phep lam dang nhap
            // that bai. Khong log URL/token de tranh lo thong tin provider.
            logger.LogDebug(ex, "Khong tai duoc avatar Google luc tao tai khoan OAuth");
            return null;
        }
    }
}
