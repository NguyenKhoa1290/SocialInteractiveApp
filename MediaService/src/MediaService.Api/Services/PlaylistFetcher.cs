using System.Net;

namespace MediaService.Api.Services;

public record FetchResult(
    bool Ok,
    string? Content,
    string? Error,
    bool Blocked = false,
    string? ContentType = null,
    string? ResolvedUrl = null);

public record UrlResolutionResult(bool Ok, string? Url, string? Error, bool Blocked = false);

// Tai playlist va giai URL redirect o phia server. Server chi doc manifest khi
// can phan loai/nhap playlist; duong phat chi lay URL cuoi, khong proxy video.
public class PlaylistFetcher(HttpClient httpClient, ILogger<PlaylistFetcher> logger)
{
    private const int MaxBytes = 8 * 1024 * 1024;
    private const int PeekBytes = 64 * 1024;
    private const int MaxRedirects = 8;
    private static readonly TimeSpan Timeout = TimeSpan.FromSeconds(20);
    private static readonly TimeSpan PeekTimeout = TimeSpan.FromSeconds(8);

    // Nhieu nguon doi noi dung theo client. Dung UA kieu IPTV player de tranh
    // bi tra ve trang/clip gioi thieu thay vi manifest.
    private const string UserAgent = "VLC/3.0.20 LibVLC/3.0.20";

    public Task<FetchResult> PeekAsync(string url, CancellationToken ct = default) =>
        FetchAsync(url, PeekBytes, PeekTimeout, ct);

    public Task<FetchResult> FetchAsync(string url, CancellationToken ct = default) =>
        FetchAsync(url, MaxBytes, Timeout, ct);

    // Chi theo redirect va tra URL cuoi, KHONG doc body/manifest/segment.
    // Frontend se tao mot request moi toi CDN cuoi, nen toan bo video van di
    // thang CDN -> client va khong ton bang thong Media Service.
    public async Task<UrlResolutionResult> ResolveUrlAsync(string url, CancellationToken ct = default)
    {
        using var cts = CancellationTokenSource.CreateLinkedTokenSource(ct);
        cts.CancelAfter(PeekTimeout);

        try
        {
            var opened = await OpenFinalResponseAsync(url, cts.Token);
            using var response = opened.Response;
            if (response is null)
                return new UrlResolutionResult(false, null, opened.Error, opened.Blocked);
            if (!response.IsSuccessStatusCode)
                return new UrlResolutionResult(false, null, $"Nguồn trả về lỗi {(int)response.StatusCode}");

            return new UrlResolutionResult(true, opened.FinalUri!.AbsoluteUri, null);
        }
        catch (OperationCanceledException)
        {
            return new UrlResolutionResult(false, null, "Nguồn không phản hồi trong 8 giây");
        }
        catch (Exception ex)
        {
            logger.LogWarning(ex, "Khong giai duoc URL IPTV {Url}", url);
            return new UrlResolutionResult(false, null, "Không kết nối được URL IPTV");
        }
    }

    private async Task<FetchResult> FetchAsync(
        string url,
        int maxBytes,
        TimeSpan timeout,
        CancellationToken ct)
    {
        try
        {
            using var cts = CancellationTokenSource.CreateLinkedTokenSource(ct);
            cts.CancelAfter(timeout);

            var opened = await OpenFinalResponseAsync(url, cts.Token);
            using var response = opened.Response;
            if (response is null)
                return new FetchResult(false, null, opened.Error, opened.Blocked);
            if (!response.IsSuccessStatusCode)
                return new FetchResult(false, null, $"Nguồn trả về lỗi {(int)response.StatusCode}");

            using var stream = await response.Content.ReadAsStreamAsync(cts.Token);
            var buffer = new byte[maxBytes];
            var total = 0;
            while (total < maxBytes)
            {
                var read = await stream.ReadAsync(buffer.AsMemory(total, maxBytes - total), cts.Token);
                if (read == 0)
                    break;
                total += read;
            }

            var contentType = response.Content.Headers.ContentType?.MediaType;
            var resolvedUrl = opened.FinalUri!.AbsoluteUri;
            if (total == 0)
            {
                return new FetchResult(
                    false,
                    null,
                    "Nguồn trả về nội dung rỗng",
                    ContentType: contentType,
                    ResolvedUrl: resolvedUrl);
            }

            return new FetchResult(
                true,
                System.Text.Encoding.UTF8.GetString(buffer, 0, total),
                null,
                ContentType: contentType,
                ResolvedUrl: resolvedUrl);
        }
        catch (OperationCanceledException)
        {
            return new FetchResult(false, null, $"Nguồn không phản hồi trong {timeout.TotalSeconds:0} giây");
        }
        catch (Exception ex)
        {
            logger.LogWarning(ex, "Khong tai duoc playlist tu {Url}", url);
            return new FetchResult(false, null, "Không tải được nội dung từ URL này");
        }
    }

    private sealed record OpenResult(
        HttpResponseMessage? Response,
        Uri? FinalUri,
        string? Error,
        bool Blocked = false);

    private async Task<OpenResult> OpenFinalResponseAsync(string url, CancellationToken ct)
    {
        if (!Uri.TryCreate(url, UriKind.Absolute, out var current) ||
            current.Scheme is not ("http" or "https"))
        {
            return new OpenResult(
                null,
                null,
                "URL phải bắt đầu bằng http:// hoặc https://",
                Blocked: true);
        }

        var visited = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        for (var hop = 0; hop <= MaxRedirects; hop++)
        {
            if (!visited.Add(current.AbsoluteUri))
                return new OpenResult(null, null, "Nguồn chuyển hướng lặp lại URL");

            // Kiem URL goc va LAP LAI voi tung dich redirect. ConnectCallback
            // trong PublicHttpConnection kiem DNS them mot lan khi mo socket.
            var blocked = await PublicHttpConnection.ValidateHostAsync(current.Host, ct);
            if (blocked is not null)
                return new OpenResult(null, null, blocked, Blocked: true);

            using var request = new HttpRequestMessage(HttpMethod.Get, current);
            request.Headers.TryAddWithoutValidation("User-Agent", UserAgent);
            request.Headers.TryAddWithoutValidation(
                "Accept",
                "application/x-mpegURL, audio/mpegurl, application/vnd.apple.mpegurl, text/plain, */*");
            request.Headers.TryAddWithoutValidation(
                "Accept-Language",
                "vi-VN,vi;q=0.9,en-US;q=0.8,en;q=0.7");

            var response = await httpClient.SendAsync(
                request,
                HttpCompletionOption.ResponseHeadersRead,
                ct);
            if (!IsRedirect(response.StatusCode))
                return new OpenResult(response, current, null);

            if (hop == MaxRedirects)
            {
                response.Dispose();
                return new OpenResult(null, null, $"Nguồn chuyển hướng quá {MaxRedirects} lần");
            }

            var location = response.Headers.Location;
            response.Dispose();
            if (location is null)
                return new OpenResult(null, null, "Nguồn chuyển hướng nhưng không có địa chỉ đích");

            Uri next;
            try
            {
                next = location.IsAbsoluteUri ? location : new Uri(current, location);
            }
            catch (UriFormatException)
            {
                return new OpenResult(null, null, "Nguồn trả về địa chỉ chuyển hướng không hợp lệ");
            }

            if (next.Scheme is not ("http" or "https"))
            {
                return new OpenResult(
                    null,
                    null,
                    "Đích chuyển hướng phải dùng http:// hoặc https://",
                    Blocked: true);
            }

            current = next;
        }

        return new OpenResult(null, null, $"Nguồn chuyển hướng quá {MaxRedirects} lần");
    }

    private static bool IsRedirect(HttpStatusCode status) => status is
        HttpStatusCode.MovedPermanently or
        HttpStatusCode.Found or
        HttpStatusCode.SeeOther or
        HttpStatusCode.TemporaryRedirect or
        HttpStatusCode.PermanentRedirect;
}
