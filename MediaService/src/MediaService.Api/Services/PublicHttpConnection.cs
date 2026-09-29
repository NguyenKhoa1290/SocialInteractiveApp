using System.Net;
using System.Net.Sockets;

namespace MediaService.Api.Services;

// Lop phong ve thu hai cho cac URL do nguoi dung cung cap.
// PlaylistFetcher kiem DNS truoc moi request de tra loi ro rang; ConnectCallback
// kiem lai ngay luc mo socket de mot ten mien khong the DNS-rebind sang IP noi bo
// trong khoang giua hai thao tac.
public static class PublicHttpConnection
{
    public static SocketsHttpHandler CreateHandler() => new()
    {
        AllowAutoRedirect = false,
        UseProxy = false,
        ConnectCallback = ConnectAsync,
    };

    public static async Task<string?> ValidateHostAsync(string host, CancellationToken ct)
    {
        IPAddress[] addresses;
        try
        {
            addresses = IPAddress.TryParse(host, out var literal)
                ? [literal]
                : await Dns.GetHostAddressesAsync(host, ct);
        }
        catch
        {
            return "Khong phan giai duoc ten mien";
        }

        if (addresses.Length == 0)
            return "Khong phan giai duoc ten mien";

        return addresses.Any(IsNotPublic)
            ? "URL tro toi dia chi noi bo hoac khong cong khai - khong cho phep"
            : null;
    }

    private static async ValueTask<Stream> ConnectAsync(
        SocketsHttpConnectionContext context,
        CancellationToken ct)
    {
        var addresses = IPAddress.TryParse(context.DnsEndPoint.Host, out var literal)
            ? [literal]
            : await Dns.GetHostAddressesAsync(context.DnsEndPoint.Host, ct);

        // Neu DNS tra ca IP cong khai va IP noi bo thi chan toan bo. Khong thu
        // "chon IP tot" vi ke tan cong co the thay doi thu tu ban ghi DNS.
        if (addresses.Length == 0 || addresses.Any(IsNotPublic))
            throw new HttpRequestException("Blocked non-public destination");

        Exception? lastError = null;
        foreach (var address in addresses)
        {
            var socket = new Socket(address.AddressFamily, SocketType.Stream, ProtocolType.Tcp)
            {
                NoDelay = true,
            };

            try
            {
                await socket.ConnectAsync(new IPEndPoint(address, context.DnsEndPoint.Port), ct);
                return new NetworkStream(socket, ownsSocket: true);
            }
            catch (Exception ex) when (!ct.IsCancellationRequested)
            {
                socket.Dispose();
                lastError = ex;
            }
        }

        throw new HttpRequestException("Khong ket noi duoc may chu IPTV", lastError);
    }

    private static bool IsNotPublic(IPAddress address)
    {
        if (address.IsIPv4MappedToIPv6)
            address = address.MapToIPv4();

        if (IPAddress.IsLoopback(address) ||
            address.Equals(IPAddress.Any) ||
            address.Equals(IPAddress.IPv6Any))
            return true;

        var bytes = address.GetAddressBytes();
        if (address.AddressFamily == AddressFamily.InterNetwork)
        {
            return bytes[0] switch
            {
                0 => true,
                10 => true,
                100 => bytes[1] is >= 64 and <= 127,       // CGNAT
                127 => true,
                169 => bytes[1] == 254,                    // link-local/metadata
                172 => bytes[1] is >= 16 and <= 31,
                192 => bytes[1] == 168 ||
                       (bytes[1] == 0 && bytes[2] is 0 or 2), // private + protocol/docs
                198 => bytes[1] is 18 or 19 ||
                       (bytes[1] == 51 && bytes[2] == 100), // benchmark/docs
                203 => bytes[1] == 0 && bytes[2] == 113,   // documentation
                _ => bytes[0] >= 224,                      // multicast/reserved
            };
        }

        if (address.AddressFamily == AddressFamily.InterNetworkV6)
        {
            if (address.IsIPv6LinkLocal || address.IsIPv6SiteLocal || address.IsIPv6Multicast)
                return true;

            // fc00::/7 (ULA) va 2001:db8::/32 (documentation).
            if ((bytes[0] & 0xFE) == 0xFC)
                return true;
            if (bytes[0] == 0x20 && bytes[1] == 0x01 && bytes[2] == 0x0D && bytes[3] == 0xB8)
                return true;
        }

        return false;
    }
}
