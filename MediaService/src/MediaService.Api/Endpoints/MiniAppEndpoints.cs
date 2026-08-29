using MediaService.Api.Data;
using MediaService.Api.Models;
using MediaService.Api.Services;
using Microsoft.EntityFrameworkCore;

namespace MediaService.Api.Endpoints;

// UC-37 (Phase 6, Mini App IPTV). Danh sach kenh la CUA RIENG tung user
// (khong gan voi 1 cuoc hop cu the) - user tu quan ly truoc, khi vao hop
// thi chon 1 kenh de xem (xem MiniAppSessionEndpoints.cs cho phan gan voi
// 1 phien hop cu the).
public static class MiniAppEndpoints
{
    // Do dai toi da cua cac cot VARCHAR trong miniapp-db-init.sql. Phai khop -
    // lech mot chu la Postgres nem 22001 va ca lan nhap vo giua chung.
    private const int MaxTen = 100;
    // KHONG con gioi han do dai URL: cot stream_url da doi sang TEXT. Link
    // luong cua nhieu nha cung cap co token ky rat dai - cat la hong han
    // duong dan, ma bo qua kenh do thi nguoi dung mat kenh khong hieu vi sao.

    // Cat cho vua cot thay vi de CSDL nem loi.
    //
    // LOI THAT DA GAP: mot playlist M3U cong khai co ten kenh dai hon 100 ky
    // tu -> "22001: value too long for type character varying(100)" -> ca
    // request tra 500. Te hon la lan nhap KHONG sach: vong lap goi
    // SaveChangesAsync moi khi gap nhom moi, ma moi lan luu la ghi luon cac
    // kenh dang cho, nen nguoi dung nhan bao loi trong khi 352 kenh da nam
    // trong CSDL. Ten bi cat con 100 chu van dung duoc; vo ca lan nhap thi
    // khong.
    private static string Cat(string s, int max) => s.Length <= max ? s : s[..max];

    // Ai DOC duoc playlist nay, va co SUA duoc khong.
    //
    // Hai cau hoi khac nhau va truoc day khong ai tach ra: moi cho deu viet
    // `list.UserId != userId` roi tra 404. Voi playlist dung chung thi luat do
    // sai ca hai dau - moi nguoi phai doc duoc, con sua thi chi admin.
    //
    // Tra null khi khong duoc doc - CO Y tra "khong thay" thay vi "bi cam":
    // mot playlist rieng cua nguoi khac thi su ton tai cua no cung khong phai
    // viec cua nguoi dang hoi.
    private static async Task<(IptvChannelList? DanhSach, bool SuaDuoc)> TimAsync(
        MiniAppDbContext db, long listId, long userId, bool laAdmin, CancellationToken ct = default)
    {
        var list = await db.IptvChannelLists.FindAsync([listId], ct);
        if (list is null)
            return (null, false);

        var laCuaMinh = list.UserId == userId;
        if (!laCuaMinh && !list.IsShared)
            return (null, false);

        // Playlist dung chung: chi admin sua, ke ca admin khac da tao ra no.
        // Playlist rieng: chi chu no.
        var suaDuoc = list.IsShared ? laAdmin : laCuaMinh;
        return (list, suaDuoc);
    }

    public static void MapMiniAppEndpoints(this WebApplication app)
    {
        var group = app.MapGroup("/miniapps/iptv").RequireAuthorization();

        group.MapGet("/channel-lists", async (System.Security.Claims.ClaimsPrincipal principal, MiniAppDbContext db) =>
        {
            var userId = principal.GetUserId()!.Value;
            var laAdmin = principal.IsAdmin();

            // Playlist cua chinh minh + moi playlist dung chung do admin dat
            // san. Sap dung chung xuong duoi de danh sach rieng - thu nguoi
            // dung tu them - luon nam tren.
            var lists = await db.IptvChannelLists
                .Where(l => l.UserId == userId || l.IsShared)
                .OrderBy(l => l.IsShared)
                .ThenBy(l => l.Id)
                .ToListAsync();

            return Results.Ok(lists.Select(l => IptvChannelListResponse.FromEntity(
                l, l.IsShared ? laAdmin : l.UserId == userId)));
        });

        group.MapPost("/channel-lists", async (CreateChannelListRequest req, System.Security.Claims.ClaimsPrincipal principal, MiniAppDbContext db) =>
        {
            if (string.IsNullOrWhiteSpace(req.Name))
                return Results.BadRequest(new ErrorResponse("invalid_request", "name khong duoc trong"));
            if (req.Name.Length > MaxTen)
                return Results.BadRequest(new ErrorResponse("invalid_request", $"Ten playlist toi da {MaxTen} ky tu"));

            var userId = principal.GetUserId()!.Value;
            var laAdmin = principal.IsAdmin();
            var dungChung = req.Shared == true;

            if (dungChung && !laAdmin)
                return Results.Json(
                    new ErrorResponse("forbidden", "Chi quan tri vien duoc dat playlist dung chung"),
                    statusCode: 403);

            var list = new IptvChannelList
            {
                UserId = userId,
                Name = req.Name,
                IsShared = dungChung,
                CreatedAt = DateTimeOffset.UtcNow,
            };
            db.IptvChannelLists.Add(list);
            await db.SaveChangesAsync();

            return Results.Created(
                $"/miniapps/iptv/channel-lists/{list.Id}",
                IptvChannelListResponse.FromEntity(list, true));
        });

        // Thieu sot phat hien khi build Frontend F5: co POST tao group/channel
        // nhung KHONG co GET nao doc lai duoc - danh sach kenh tao xong thi
        // khong hien thi lai duoc o bat ky dau, Mini App IPTV khong the co
        // giao dien. Tra ve nguyen cay (groups + channels long nhau) trong 1
        // request vi so luong kenh cua 1 danh sach ca nhan luon nho.
        group.MapGet("/channel-lists/{listId:long}/groups", async (
            long listId, System.Security.Claims.ClaimsPrincipal principal, MiniAppDbContext db) =>
        {
            var userId = principal.GetUserId()!.Value;
            var (list, _) = await TimAsync(db, listId, userId, principal.IsAdmin());
            if (list is null)
                return Results.NotFound();

            var groups = await db.IptvChannelGroups.Where(g => g.ListId == listId).ToListAsync();
            var groupIds = groups.Select(g => g.Id).ToList();
            var channels = await db.IptvChannels.Where(c => groupIds.Contains(c.GroupId)).ToListAsync();

            return Results.Ok(groups.Select(g => new IptvChannelGroupResponse(
                g.Id,
                g.GroupName,
                [.. channels.Where(c => c.GroupId == g.Id)
                    .Select(c => new IptvChannelResponse(c.Id, c.ChannelName, c.StreamUrl, c.AudioTrack))])));
        });

        group.MapPost("/channel-lists/{listId:long}/groups", async (
            long listId, CreateChannelGroupRequest req, System.Security.Claims.ClaimsPrincipal principal, MiniAppDbContext db) =>
        {
            if (string.IsNullOrWhiteSpace(req.GroupName))
                return Results.BadRequest(new ErrorResponse("invalid_request", "groupName khong duoc trong"));
            if (req.GroupName.Length > MaxTen)
                return Results.BadRequest(new ErrorResponse("invalid_request", $"Ten playlist con toi da {MaxTen} ky tu"));

            var userId = principal.GetUserId()!.Value;
            var (list, suaDuoc) = await TimAsync(db, listId, userId, principal.IsAdmin());
            if (list is null)
                return Results.NotFound();
            if (!suaDuoc)
                return Results.Json(new ErrorResponse("forbidden", "Playlist nay ban chi xem duoc"), statusCode: 403);

            var channelGroup = new IptvChannelGroup { ListId = listId, GroupName = req.GroupName };
            db.IptvChannelGroups.Add(channelGroup);
            await db.SaveChangesAsync();

            return Results.Created($"/miniapps/iptv/channel-lists/{listId}/groups/{channelGroup.Id}", null);
        });

        // Nhap ca mot playlist M3U vao danh sach.
        //
        // VI SAO CAN: rat nhieu URL .m3u8 nguoi dung dan vao that ra la DANH
        // SACH hang tram kenh chu khong phai mot luong. Truoc day luu nguyen
        // no thanh mot "kenh", trinh phat doc cac URL kenh nhu the chung la
        // segment cua cung mot luong roi phat ra rac - dung nghia "chua tuong
        // thich".
        //
        // Nhom duoc tao tu thuoc tinh group-title trong playlist, va DUNG LAI
        // nhom trung ten neu da co - nhap playlist lan hai khong sinh ra mot
        // loat nhom trung.
        group.MapPost("/channel-lists/{listId:long}/import", async (
            long listId, ImportPlaylistRequest req, System.Security.Claims.ClaimsPrincipal principal,
            MiniAppDbContext db, PlaylistImporter importer, CancellationToken ct) =>
        {
            if (string.IsNullOrWhiteSpace(req.Url))
                return Results.BadRequest(new ErrorResponse("invalid_request", "url khong duoc trong"));

            var userId = principal.GetUserId()!.Value;
            var (list, suaDuoc) = await TimAsync(db, listId, userId, principal.IsAdmin(), ct);
            if (list is null)
                return Results.NotFound();
            if (!suaDuoc)
                return Results.Json(new ErrorResponse("forbidden", "Playlist nay ban chi xem duoc"), statusCode: 403);

            // Toan bo viec nhap nam trong PlaylistImporter vi bo lam moi tu
            // dong (moi 10 phut) cung goi dung ham do - hai duong phai hanh xu
            // y het nhau.
            var kq = await importer.NhapAsync(db, list, req.Url, req.AutoGroups != false, ct);

            if (kq.Loi is not null)
                return Results.UnprocessableEntity(new ErrorResponse("fetch_failed", kq.Loi));
            if (!kq.LaPlaylist)
                return Results.Ok(new ImportPlaylistResponse(false, 0, 0, 0));

            // `skipped` gio mang nghia "kenh da co, chi doi lai duong dan
            // luong" - so cu la so kenh bi bo qua vi trung URL.
            return Results.Ok(new ImportPlaylistResponse(true, kq.Them, kq.CapNhat, kq.NhomMoi));
        });

        group.MapPost("/channel-lists/{listId:long}/groups/{groupId:long}/channels", async (
            long listId, long groupId, CreateChannelRequest req, System.Security.Claims.ClaimsPrincipal principal, MiniAppDbContext db) =>
        {
            if (string.IsNullOrWhiteSpace(req.ChannelName) || string.IsNullOrWhiteSpace(req.StreamUrl))
                return Results.BadRequest(new ErrorResponse("invalid_request", "channelName va streamUrl khong duoc trong"));
            if (req.ChannelName.Length > MaxTen)
                return Results.BadRequest(new ErrorResponse("invalid_request", $"Ten kenh toi da {MaxTen} ky tu"));

            var userId = principal.GetUserId()!.Value;
            var (list, suaDuoc) = await TimAsync(db, listId, userId, principal.IsAdmin());
            if (list is null)
                return Results.NotFound();
            if (!suaDuoc)
                return Results.Json(new ErrorResponse("forbidden", "Playlist nay ban chi xem duoc"), statusCode: 403);

            var channelGroup = await db.IptvChannelGroups.FirstOrDefaultAsync(g => g.Id == groupId && g.ListId == listId);
            if (channelGroup is null)
                return Results.NotFound();

            var channel = new IptvChannel
            {
                GroupId = groupId,
                ChannelName = req.ChannelName,
                StreamUrl = req.StreamUrl,
                AudioTrack = req.AudioTrack,
            };
            db.IptvChannels.Add(channel);
            await db.SaveChangesAsync();

            return Results.Created($"/miniapps/iptv/channel-lists/{listId}/groups/{groupId}/channels/{channel.Id}", null);
        });

        // Xoa ca playlist. Truoc day KHONG co duong xoa nao ca - dan nham mot
        // link hong la no nam do vinh vien, va man quan ly chi day len mai.
        // Cac bang con di theo qua FK ON DELETE CASCADE.
        group.MapDelete("/channel-lists/{listId:long}", async (
            long listId, System.Security.Claims.ClaimsPrincipal principal, MiniAppDbContext db) =>
        {
            var userId = principal.GetUserId()!.Value;
            var (list, suaDuoc) = await TimAsync(db, listId, userId, principal.IsAdmin());
            if (list is null)
                return Results.NotFound();
            if (!suaDuoc)
                return Results.Json(new ErrorResponse("forbidden", "Playlist nay ban chi xem duoc"), statusCode: 403);

            db.IptvChannelLists.Remove(list);
            await db.SaveChangesAsync();
            return Results.NoContent();
        });

        // Xoa mot playlist con. Kenh ben trong di theo qua FK ON DELETE CASCADE
        // khai bao o miniapp-db-init.sql.
        group.MapDelete("/channel-lists/{listId:long}/groups/{groupId:long}", async (
            long listId, long groupId, System.Security.Claims.ClaimsPrincipal principal, MiniAppDbContext db) =>
        {
            var userId = principal.GetUserId()!.Value;
            var (list, suaDuoc) = await TimAsync(db, listId, userId, principal.IsAdmin());
            if (list is null)
                return Results.NotFound();
            if (!suaDuoc)
                return Results.Json(new ErrorResponse("forbidden", "Playlist nay ban chi xem duoc"), statusCode: 403);

            // Rang buoc groupId PHAI thuoc dung listId vua kiem quyen - khong
            // thi mot groupId cua playlist nguoi khac ghep vao listId cua minh
            // se xoa duoc.
            var channelGroup = await db.IptvChannelGroups
                .FirstOrDefaultAsync(g => g.Id == groupId && g.ListId == listId);
            if (channelGroup is null)
                return Results.NotFound();

            db.IptvChannelGroups.Remove(channelGroup);
            await db.SaveChangesAsync();
            return Results.NoContent();
        });

        group.MapDelete("/channel-lists/{listId:long}/groups/{groupId:long}/channels/{channelId:long}", async (
            long listId, long groupId, long channelId,
            System.Security.Claims.ClaimsPrincipal principal, MiniAppDbContext db) =>
        {
            var userId = principal.GetUserId()!.Value;
            var (list, suaDuoc) = await TimAsync(db, listId, userId, principal.IsAdmin());
            if (list is null)
                return Results.NotFound();
            if (!suaDuoc)
                return Results.Json(new ErrorResponse("forbidden", "Playlist nay ban chi xem duoc"), statusCode: 403);

            // Rang buoc ca ba tang: kenh phai thuoc dung nhom, va nhom phai
            // thuoc dung playlist vua kiem quyen - khong thi mot id kenh cua
            // nguoi khac ghep vao mot listId cua minh se xoa duoc.
            var channel = await db.IptvChannels
                .Where(c => c.Id == channelId && c.GroupId == groupId)
                .Join(db.IptvChannelGroups.Where(g => g.ListId == listId), c => c.GroupId, g => g.Id, (c, _) => c)
                .FirstOrDefaultAsync();
            if (channel is null)
                return Results.NotFound();

            db.IptvChannels.Remove(channel);
            await db.SaveChangesAsync();
            return Results.NoContent();
        });
    }
}
