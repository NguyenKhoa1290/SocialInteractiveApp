using System.Net;
using System.Net.Sockets;

namespace MediaService.Api.Services;

// Blocked = bi TU CHOI vi ly do an toan (scheme la, dia chi noi bo), khac
// han voi that bai vi mang. Noi goi phai phan biet: dia chi noi bo thi tuyet
// doi khong duoc di tiep, con nguon khong phan hoi thi con duong xu ly khac.
public record FetchResult(bool Ok, string? Content, string? Error, bool Blocked = false, string? ContentType = null);

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

    // Chi de PHAN LOAI thi khong can tai het: cac the quyet dinh (#EXTM3U,
    // #EXT-X-STREAM-INF, #EXT-X-TARGETDURATION, vai muc #EXTINF dau tien) deu
    // nam o dau file. 64 KB la thua du.
    private const int PeekBytes = 64 * 1024;

    private static readonly TimeSpan Timeout = TimeSpan.FromSeconds(20);
    private static readonly TimeSpan PeekTimeout = TimeSpan.FromSeconds(8);

    // Nhieu nguon IPTV tu choi client khong phai trinh duyet. Khong gia mao
    // gi ca - chi la khai bao mot UA thong thuong thay vi de trong, neu
    // khong thi mot link nguoi dung xem duoc trong Chrome lai bi bao la hong.
    private const string UserAgent =
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36";

    // Doc vua du de PHAN LOAI roi dung han.
    //
    // VI SAO CAN RIENG: FetchAsync doc toi khi het du lieu hoac day 8 MB. Rat
    // nhieu URL IPTV khong tra ve mot file ma la mot LUONG KHONG BAO GIO KET
    // THUC (hoac chuyen huong toi mot cai nhu vay). Voi nhung URL do,
    // FetchAsync luon chay het 20 giay roi bao "nguon khong phan hoi" - sai
    // hoan toan, nguon phan hoi rat tot, chi la no khong co diem dung. Do
    // that tren link VTV6 cua nguoi dung: dung nhu vay.
    public Task<FetchResult> PeekAsync(string url, CancellationToken ct = default) =>
        FetchAsync(url, PeekBytes, PeekTimeout, ct);

    public Task<FetchResult> FetchAsync(string url, CancellationToken ct = default) =>
        FetchAsync(url, MaxBytes, Timeout, ct);

    private async Task<FetchResult> FetchAsync(string url, int maxBytes, TimeSpan timeout, CancellationToken ct)
    {
        if (!Uri.TryCreate(url, UriKind.Absolute, out var uri) || uri.Scheme is not ("http" or "https"))
            return new FetchResult(false, null, "URL phải bắt đầu bằng http:// hoặc https://", Blocked: true);

        var blocked = await IsBlockedAddressAsync(uri.Host, ct);
        if (blocked is not null)
            return new FetchResult(false, null, blocked, Blocked: true);

        try
        {
            using var cts = CancellationTokenSource.CreateLinkedTokenSource(ct);
            cts.CancelAfter(timeout);

            using var req = new HttpRequestMessage(HttpMethod.Get, uri);
            req.Headers.TryAddWithoutValidation("User-Agent", UserAgent);

            using var resp = await httpClient.SendAsync(req, HttpCompletionOption.ResponseHeadersRead, cts.Token);
            if (!resp.IsSuccessStatusCode)
                return new FetchResult(false, null, $"Nguồn trả về lỗi {(int)resp.StatusCode}");

            // Doc co gioi han thay vi ReadAsStringAsync: khong tin vao
            // Content-Length do may chu kia khai bao.
            using var stream = await resp.Content.ReadAsStreamAsync(cts.Token);
            var buffer = new byte[maxBytes];
            var total = 0;
            while (total < maxBytes)
            {
                var read = await stream.ReadAsync(buffer.AsMemory(total, maxBytes - total), cts.Token);
                if (read == 0) break;
                total += read;
            }

            var contentType = resp.Content.Headers.ContentType?.MediaType;

            if (total == 0)
                return new FetchResult(false, null, "Nguồn trả về nội dung rỗng", ContentType: contentType);

            return new FetchResult(
                true, System.Text.Encoding.UTF8.GetString(buffer, 0, total), null, ContentType: contentType);
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
