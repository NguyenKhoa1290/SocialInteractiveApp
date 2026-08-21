using System.Text.RegularExpressions;

namespace MediaService.Api.Services;

public record M3uEntry(string Name, string Url, string? GroupTitle);

public enum M3uKind
{
    // Playlist liet ke NHIEU KENH khac nhau (dang IPTV thuong gap): moi
    // #EXTINF la mot dai truyen hinh rieng, khong phai mot doan cua cung mot
    // luong. Phai tach ra thanh nhieu kenh.
    ChannelList,

    // Mot luong HLS that su - hoac media playlist (danh sach segment), hoac
    // master playlist (nhieu muc chat luong cua CUNG mot noi dung). Ca hai
    // deu la MOT kenh; hls.js tu xu ly phan chon bitrate.
    SingleStream,

    // Khong phai M3U, hoac rong.
    Unknown,
}

// Phan tich playlist M3U/M3U8.
//
// VI SAO CAN: nguoi dung dan mot URL .m3u8 vao o "kenh", nhung rat nhieu URL
// kieu do that ra la DANH SACH hang tram kenh chu khong phai mot luong. Luu
// nguyen no thanh mot kenh thi trinh phat doc cac URL kenh nhu the chung la
// segment cua cung mot luong - phat ra rac.
//
// Phan biet ba loai o day, roi noi goi quyet dinh: nhieu kenh thi nhap thanh
// nhieu ban ghi, mot luong thi giu nguyen nhu cu.
public static class M3uPlaylist
{
    // Toi da 2000 kenh mot lan nhap. Playlist IPTV cong khai co the co hang
    // chuc nghin dong - nhap het vao thi vua nghen CSDL vua khong ai dung noi.
    public const int MaxChannels = 2000;

    // #EXTINF:<thoi-luong> <cac-thuoc-tinh>,<Ten kenh>
    // Thoi luong -1 nghia la "khong xac dinh" - dau hieu quen thuoc cua
    // playlist IPTV, nhung KHONG dua vao mot minh no de phan loai (xem Detect).
    private static readonly Regex ExtInf = new(
        @"^#EXTINF:(?<dur>-?[\d.]+)(?<attrs>[^,]*),(?<name>.*)$",
        RegexOptions.Compiled | RegexOptions.IgnoreCase);

    private static readonly Regex GroupTitleAttr = new(
        @"group-title\s*=\s*""(?<v>[^""]*)""",
        RegexOptions.Compiled | RegexOptions.IgnoreCase);

    public static M3uKind Detect(string content)
    {
        if (string.IsNullOrWhiteSpace(content))
            return M3uKind.Unknown;

        // Hai the nay CHI xuat hien trong luong HLS that. Kiem chung truoc
        // #EXTINF vi media playlist cung co #EXTINF (moi segment mot dong) -
        // xet nham thu tu la coi mot luong binh thuong thanh danh sach kenh.
        if (content.Contains("#EXT-X-STREAM-INF", StringComparison.OrdinalIgnoreCase) ||
            content.Contains("#EXT-X-TARGETDURATION", StringComparison.OrdinalIgnoreCase))
            return M3uKind.SingleStream;

        if (!content.Contains("#EXTM3U", StringComparison.OrdinalIgnoreCase) &&
            !content.Contains("#EXTINF", StringComparison.OrdinalIgnoreCase))
            return M3uKind.Unknown;

        // Toi day chac chan khong phai luong HLS. Co tu 2 muc tro len thi la
        // danh sach kenh; dung 1 muc thi giu nguyen thanh mot kenh (nhap vao
        // roi lai ra dung mot ban ghi thi chi lam nguoi dung roi tri).
        return Parse(content, "").Count >= 2 ? M3uKind.ChannelList : M3uKind.SingleStream;
    }

    // baseUrl dung de doi URL tuong doi thanh tuyet doi (mot so playlist ghi
    // duong dan tuong doi so voi chinh no).
    public static List<M3uEntry> Parse(string content, string baseUrl)
    {
        var entries = new List<M3uEntry>();
        string? pendingName = null;
        string? pendingGroup = null;
        string? extGrp = null; // #EXTGRP ap cho cac muc PHIA SAU no (dinh dang cu)

        foreach (var raw in content.Split('\n'))
        {
            var line = raw.Trim();
            if (line.Length == 0)
                continue;

            if (line.StartsWith('#'))
            {
                if (line.StartsWith("#EXTGRP:", StringComparison.OrdinalIgnoreCase))
                {
                    extGrp = line["#EXTGRP:".Length..].Trim();
                    continue;
                }

                var m = ExtInf.Match(line);
                if (!m.Success)
                    continue; // #EXTVLCOPT, #EXTM3U, chu thich... - bo qua

                pendingName = m.Groups["name"].Value.Trim();
                var g = GroupTitleAttr.Match(m.Groups["attrs"].Value);
                pendingGroup = g.Success ? g.Groups["v"].Value.Trim() : null;
                continue;
            }

            // Dong khong bat dau bang # la URL. Chi nhan khi truoc do co
            // #EXTINF - dong URL tro troi khong co ten thi khong biet goi la gi.
            if (pendingName is null)
                continue;

            var url = Absolutize(line, baseUrl);
            if (url is not null)
                entries.Add(new M3uEntry(
                    pendingName.Length > 0 ? pendingName : url,
                    url,
                    string.IsNullOrWhiteSpace(pendingGroup) ? extGrp : pendingGroup));

            pendingName = null;
            pendingGroup = null;
        }

        return entries;
    }

    private static string? Absolutize(string url, string baseUrl)
    {
        if (Uri.TryCreate(url, UriKind.Absolute, out var abs))
            return abs.Scheme is "http" or "https" ? abs.ToString() : null;

        if (!string.IsNullOrEmpty(baseUrl) &&
            Uri.TryCreate(new Uri(baseUrl), url, out var combined) &&
            combined.Scheme is "http" or "https")
            return combined.ToString();

        return null;
    }
}
