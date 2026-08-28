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
            MiniAppDbContext db, PlaylistFetcher fetcher, CancellationToken ct) =>
        {
            if (string.IsNullOrWhiteSpace(req.Url))
                return Results.BadRequest(new ErrorResponse("invalid_request", "url khong duoc trong"));

            var userId = principal.GetUserId()!.Value;
            var (list, suaDuoc) = await TimAsync(db, listId, userId, principal.IsAdmin(), ct);
            if (list is null)
                return Results.NotFound();
            if (!suaDuoc)
                return Results.Json(new ErrorResponse("forbidden", "Playlist nay ban chi xem duoc"), statusCode: 403);

            var fetched = await fetcher.FetchAsync(req.Url, ct);
            if (!fetched.Ok)
                return Results.UnprocessableEntity(new ErrorResponse("fetch_failed", fetched.Error!));

            var kind = M3uPlaylist.Detect(fetched.Content!);
            if (kind == M3uKind.Unknown)
                return Results.UnprocessableEntity(
                    new ErrorResponse("not_a_playlist", "Nội dung tải về không phải playlist M3U"));

            // Mot luong HLS binh thuong (co #EXT-X-STREAM-INF hoac
            // #EXT-X-TARGETDURATION) thi khong co gi de tach - bao cho nguoi
            // dung them no nhu mot kenh binh thuong.
            if (kind == M3uKind.SingleStream)
                return Results.Ok(new ImportPlaylistResponse(false, 0, 0, 0));

            var entries = M3uPlaylist.Parse(fetched.Content!, req.Url);
            if (entries.Count > M3uPlaylist.MaxChannels)
                entries = entries.Take(M3uPlaylist.MaxChannels).ToList();

            // Tai san nhung gi da co de khong tao trung - mot lan doc thay vi
            // hoi lai CSDL cho tung kenh trong hang nghin kenh.
            var existingGroups = await db.IptvChannelGroups
                .Where(g => g.ListId == listId)
                .ToDictionaryAsync(g => g.GroupName, g => g, StringComparer.OrdinalIgnoreCase, ct);

            var groupIds = existingGroups.Values.Select(g => g.Id).ToList();
            var existingUrls = await db.IptvChannels
                .Where(c => groupIds.Contains(c.GroupId))
                .Select(c => c.StreamUrl)
                .ToListAsync(ct);
            var seenUrls = new HashSet<string>(existingUrls, StringComparer.OrdinalIgnoreCase);

            var newGroups = 0;
            var imported = 0;
            var skipped = 0;

            foreach (var entry in entries)
            {
                if (!seenUrls.Add(entry.Url))
                {
                    skipped++;
                    continue;
                }

                // Tat "tu dong nhan dien playlist con" thi do het vao mot nhom
                // mang ten playlist - nhieu nguon chia group-title rat lung
                // tung, nguoi dung chi muon mot danh sach phang.
                var groupName = req.AutoGroups == false
                    ? list.Name
                    : string.IsNullOrWhiteSpace(entry.GroupTitle) ? "Chua phan nhom" : entry.GroupTitle!;
                if (!existingGroups.TryGetValue(groupName, out var channelGroup))
                {
                    channelGroup = new IptvChannelGroup { ListId = listId, GroupName = groupName };
                    db.IptvChannelGroups.Add(channelGroup);
                    // Phai luu ngay de co Id gan cho kenh ben duoi.
                    await db.SaveChangesAsync(ct);
                    existingGroups[groupName] = channelGroup;
                    newGroups++;
                }

                db.IptvChannels.Add(new IptvChannel
                {
                    GroupId = channelGroup.Id,
                    ChannelName = entry.Name,
                    StreamUrl = entry.Url,
                });
                imported++;
            }

            await db.SaveChangesAsync(ct);
            return Results.Ok(new ImportPlaylistResponse(true, imported, skipped, newGroups));
        });

        group.MapPost("/channel-lists/{listId:long}/groups/{groupId:long}/channels", async (
            long listId, long groupId, CreateChannelRequest req, System.Security.Claims.ClaimsPrincipal principal, MiniAppDbContext db) =>
        {
            if (string.IsNullOrWhiteSpace(req.ChannelName) || string.IsNullOrWhiteSpace(req.StreamUrl))
                return Results.BadRequest(new ErrorResponse("invalid_request", "channelName va streamUrl khong duoc trong"));

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
