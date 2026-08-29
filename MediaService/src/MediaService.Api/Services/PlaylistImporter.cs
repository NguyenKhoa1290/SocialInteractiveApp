using MediaService.Api.Data;
using MediaService.Api.Models;
using Microsoft.EntityFrameworkCore;

namespace MediaService.Api.Services;

// Nhap mot playlist M3U vao mot danh sach kenh.
//
// Tach rieng khoi endpoint vi CO HAI nguoi goi: nguoi dung bam "Them link",
// va PlaylistRefreshService tu nhap lai moi 10 phut. Hai duong do phai hanh
// xu y HET nhau - de hai ban sao thi mot ngay nao do chung se lech.
public sealed class PlaylistImporter(PlaylistFetcher fetcher)
{
    // Do dai toi da cua cot ten. Rieng URL KHONG con gioi han: cot da doi
    // sang TEXT vi link luong cua nhieu nha cung cap co token ky rat dai.
    private const int MaxTen = 100;

    private static string Cat(string s, int max) => s.Length <= max ? s : s[..max];

    public sealed record KetQua(bool LaPlaylist, string? Loi, int Them, int CapNhat, int Xoa, int NhomMoi);

    public async Task<KetQua> NhapAsync(
        MiniAppDbContext db, IptvChannelList list, string url, bool autoGroups, CancellationToken ct)
    {
        var fetched = await fetcher.FetchAsync(url, ct);
        if (!fetched.Ok)
            return new KetQua(false, fetched.Error, 0, 0, 0, 0);

        var kind = M3uPlaylist.Detect(fetched.Content!);
        if (kind == M3uKind.Unknown)
            return new KetQua(false, "Nội dung tải về không phải playlist M3U", 0, 0, 0, 0);

        // Mot luong HLS binh thuong thi khong co gi de tach - noi goi bao cho
        // nguoi dung them no nhu mot kenh binh thuong.
        if (kind == M3uKind.SingleStream)
            return new KetQua(false, null, 0, 0, 0, 0);

        var entries = M3uPlaylist.Parse(fetched.Content!, url);
        if (entries.Count > M3uPlaylist.MaxChannels)
            entries = entries.Take(M3uPlaylist.MaxChannels).ToList();

        // Tai san nhung gi da co de khong hoi lai CSDL cho tung kenh trong
        // hang nghin kenh.
        var nhomCu = await db.IptvChannelGroups
            .Where(g => g.ListId == list.Id)
            .ToDictionaryAsync(g => g.GroupName, g => g, StringComparer.OrdinalIgnoreCase, ct);

        var idNhom = nhomCu.Values.Select(g => g.Id).ToList();
        var kenhCu = await db.IptvChannels.Where(c => idNhom.Contains(c.GroupId)).ToListAsync(ct);

        // Khoa la (nhom, TEN kenh) chu khong phai URL.
        //
        // Day la mau chot cua viec lam moi: nguon IPTV doi duong dan luong
        // luon - token het han, CDN doi. Neu doi chieu theo URL thi moi lan
        // lam moi la mot loat "kenh moi" trung ten, danh sach phinh ra mai.
        // Doi chieu theo ten thi URL moi de len URL cu, dung y nghia "lam
        // moi". Kenh nguoi dung TU them ma playlist khong co thi giu nguyen -
        // khong xoa gi ca.
        var theoTen = new Dictionary<(long, string), IptvChannel>();
        foreach (var c in kenhCu)
            theoTen[(c.GroupId, c.ChannelName.ToLowerInvariant())] = c;

        var them = 0;
        var capNhat = 0;
        var nhomMoi = 0;

        // Nhung kenh LAN NAY con thay trong nguon. Cai gi do lan nhap truoc
        // tao ra ma lan nay khong con thi la kenh da bien mat khoi nguon.
        var conThay = new HashSet<long>();

        foreach (var entry in entries)
        {
            // Tat "tu dong nhan dien playlist con" thi do het vao mot nhom
            // mang ten playlist - nhieu nguon chia group-title rat lung tung,
            // nguoi dung chi muon mot danh sach phang.
            var tenNhom = Cat(
                !autoGroups
                    ? list.Name
                    : string.IsNullOrWhiteSpace(entry.GroupTitle) ? "Chua phan nhom" : entry.GroupTitle!,
                MaxTen);

            if (!nhomCu.TryGetValue(tenNhom, out var nhom))
            {
                nhom = new IptvChannelGroup { ListId = list.Id, GroupName = tenNhom, FromImport = true };
                db.IptvChannelGroups.Add(nhom);
                // Phai luu ngay de co Id gan cho kenh ben duoi.
                await db.SaveChangesAsync(ct);
                nhomCu[tenNhom] = nhom;
                nhomMoi++;
            }

            var tenKenh = Cat(entry.Name, MaxTen);
            var khoa = (nhom.Id, tenKenh.ToLowerInvariant());

            if (theoTen.TryGetValue(khoa, out var daCo))
            {
                if (!string.Equals(daCo.StreamUrl, entry.Url, StringComparison.Ordinal))
                {
                    daCo.StreamUrl = entry.Url;
                    capNhat++;
                }
                // Danh dau lai: kenh nay CO trong nguon. Lam vay thi nhung
                // hang co truoc khi cot from_import ra doi (mac dinh false) tu
                // duoc gan dung sau lan nhap dau tien.
                daCo.FromImport = true;
                conThay.Add(daCo.Id);
                continue;
            }

            var moi = new IptvChannel
            {
                GroupId = nhom.Id,
                ChannelName = tenKenh,
                StreamUrl = entry.Url,
                FromImport = true,
            };
            db.IptvChannels.Add(moi);
            theoTen[khoa] = moi;
            them++;
        }

        // Kenh DA BIEN MAT khoi nguon thi go di - nhung CHI kenh from_import.
        // Kenh nguoi dung tu them tay khong bao gio bi dong toi du no khong co
        // trong playlist.
        //
        // Chan mot truong hop nguy hiem: nguon tra ve playlist RONG (may chu
        // loi, tra ve mot tep cut). Luc do "khong con thay kenh nao" khong co
        // nghia la nha dai bo het kenh - xoa sach la mat trang danh sach cua
        // nguoi dung vi mot loi nhat thoi ben kia. Rong thi khong xoa gi.
        var xoa = 0;
        if (entries.Count > 0)
        {
            var caiPhaiGo = kenhCu.Where(c => c.FromImport && !conThay.Contains(c.Id)).ToList();
            if (caiPhaiGo.Count > 0)
            {
                db.IptvChannels.RemoveRange(caiPhaiGo);
                xoa = caiPhaiGo.Count;
            }
        }

        list.SourceUrl = url;
        list.AutoGroups = autoGroups;
        list.RefreshedAt = DateTimeOffset.UtcNow;

        await db.SaveChangesAsync(ct);

        // Nhom DO LAN NHAP TAO RA ma khong con kenh nao thi don luon - de lai
        // mot cai tieu de nhom trong khong khong noi len dieu gi. Nhom nguoi
        // dung tu tao thi giu, ke ca khi rong.
        if (entries.Count > 0)
        {
            var nhomRong = await db.IptvChannelGroups
                .Where(g => g.ListId == list.Id && g.FromImport
                            && !db.IptvChannels.Any(c => c.GroupId == g.Id))
                .ToListAsync(ct);
            if (nhomRong.Count > 0)
            {
                db.IptvChannelGroups.RemoveRange(nhomRong);
                await db.SaveChangesAsync(ct);
            }
        }

        return new KetQua(true, null, them, capNhat, xoa, nhomMoi);
    }
}
