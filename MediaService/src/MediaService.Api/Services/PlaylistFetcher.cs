using System.Net;
using System.Net.Sockets;

namespace MediaService.Api.Services;

public record FetchResult(bool Ok, string? Content, string? Error);

// Tai noi dung playlist tu URL nguoi dung nhap.
//
// PHAI tai o BACKEND chu khong phai trinh duyet: may chu IPTV gan nhu khong
// bao gio gui header CORS, nen fetch() tu trang web se bi chan.
//
// Nhung dieu do bien endpoint nay thanh mot cong SSRF: nguoi dung doc duoc
// noi dung cua BAT KY dia chi nao ma SERVER toi duoc, ke ca nhung dia chi
// chi ton tai ben trong cum. Vi du "http://identity:8080/internal/users/admin-list"
// se tra ve danh sach nguoi dung, roi hien ra duoi dang "ten kenh".
//
// Nen phai chan tu trong: chi http/https, va dia chi phan giai ra phai la IP
// CONG CONG. Kiem tra sau khi phan giai DNS chu khong phai tren chuoi ten
// mien - neu khong thi mot ten mien tro toi 127.0.0.1 la di qua duoc.
public class PlaylistFetcher(HttpClient httpClient, ILogger<PlaylistFetcher> logger)
{
    // Playlist IPTV lon nhat gap ngoai thuc te khoang vai MB. 8 MB la du
    // rong, va du nho de mot URL doc hai khong keo sap bo nho service.
    private const int MaxBytes = 8 * 1024 * 1024;

    private static readonly TimeSpan Timeout = TimeSpan.FromSeconds(20);

    public async Task<FetchResult> FetchAsync(string url, CancellationToken ct = default)
    {
        if (!Uri.TryCreate(url, UriKind.Absolute, out var uri) || uri.Scheme is not ("http" or "https"))
            return new FetchResult(false, null, "URL phải bắt đầu bằng http:// hoặc https://");

        var blocked = await IsBlockedAddressAsync(uri.Host, ct);
        if (blocked is not null)
            return new FetchResult(false, null, blocked);

        try
        {
            using var cts = CancellationTokenSource.CreateLinkedTokenSource(ct);
            cts.CancelAfter(Timeout);

            using var resp = await httpClient.GetAsync(uri, HttpCompletionOption.ResponseHeadersRead, cts.Token);
            if (!resp.IsSuccessStatusCode)
                return new FetchResult(false, null, $"Nguồn trả về lỗi {(int)resp.StatusCode}");

            // Doc co gioi han thay vi ReadAsStringAsync: khong tin vao
            // Content-Length do may chu kia khai bao.
            using var stream = await resp.Content.ReadAsStreamAsync(cts.Token);
            var buffer = new byte[MaxBytes];
            var total = 0;
            while (total < MaxBytes)
            {
                var read = await stream.ReadAsync(buffer.AsMemory(total, MaxBytes - total), cts.Token);
                if (read == 0) break;
                total += read;
            }

            if (total == 0)
                return new FetchResult(false, null, "Nguồn trả về nội dung rỗng");

            return new FetchResult(true, System.Text.Encoding.UTF8.GetString(buffer, 0, total), null);
        }
        catch (OperationCanceledException)
        {
            return new FetchResult(false, null, "Nguồn không phản hồi trong 20 giây");
        }
        catch (Exception ex)
        {
            logger.LogWarning(ex, "Khong tai duoc playlist tu {Url}", url);
            return new FetchResult(false, null, "Không tải được nội dung từ URL này");
        }
    }

    // Tra ve null neu dia chi hop le, hoac ly do bi chan.
    private static async Task<string?> IsBlockedAddressAsync(string host, CancellationToken ct)
    {
        IPAddress[] addresses;
        try
        {
            addresses = IPAddress.TryParse(host, out var literal)
                ? [literal]
                : await Dns.GetHostAddressesAsync(host, ct);
        }
        catch (Exception)
        {
            return "Không phân giải được tên miền";
        }

        if (addresses.Length == 0)
            return "Không phân giải được tên miền";

        // Chan neu BAT KY dia chi nao la noi bo: mot ten mien co the tra ve
        // nhieu ban ghi, chi can mot cai tro vao trong la du de loi dung.
        foreach (var ip in addresses)
        {
            if (IsPrivate(ip))
                return "URL trỏ tới địa chỉ nội bộ — không cho phép";
        }

        return null;
    }

    private static bool IsPrivate(IPAddress ip)
    {
        if (IPAddress.IsLoopback(ip))
            return true;

        if (ip.AddressFamily == AddressFamily.InterNetwork)
        {
            var b = ip.GetAddressBytes();
            return b[0] switch
            {
                10 => true,                              // 10.0.0.0/8
                127 => true,                             // loopback
                0 => true,                               // 0.0.0.0/8
                172 => b[1] >= 16 && b[1] <= 31,         // 172.16.0.0/12
                192 => b[1] == 168,                      // 192.168.0.0/16
                169 => b[1] == 254,                      // link-local, gom ca metadata 169.254.169.254
                100 => b[1] >= 64 && b[1] <= 127,        // CGNAT 100.64.0.0/10
                _ => b[0] >= 224,                        // multicast + reserved
            };
        }

        if (ip.AddressFamily == AddressFamily.InterNetworkV6)
        {
            if (ip.IsIPv6LinkLocal || ip.IsIPv6SiteLocal || ip.IsIPv6Multicast)
                return true;
            // fc00::/7 - unique local address
            if ((ip.GetAddressBytes()[0] & 0xFE) == 0xFC)
                return true;
            // ::ffff:x.x.x.x - IPv4 nguy trang trong IPv6
            if (ip.IsIPv4MappedToIPv6)
                return IsPrivate(ip.MapToIPv4());
        }

        return false;
    }
}
