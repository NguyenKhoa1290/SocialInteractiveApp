using System.Security.Claims;
using MediaService.Api.Data;
using MediaService.Api.Models;
using MediaService.Api.Services;
using Microsoft.EntityFrameworkCore;

namespace MediaService.Api.Endpoints;

// Phan Mini App gan voi 1 PHIEN HOP cu the (UC-34 cho host, UC-35 cho
// participant duoc cap quyen mini_app).
public static class MiniAppSessionEndpoints
{
    // Mo ung dung la quyet dinh CUA CA PHONG, khong cap le tung nguoi nua -
    // "Cho phep mot thanh vien khong phai chu phong bat dau ung dung" trong
    // ban thiet ke (Figma 140:645). Mac dinh TAT: mo mot ung dung la chieu
    // len man hinh cua ca phong.
    private static Task<bool> CanUseMiniAppAsync(MediaDbContext db, Meeting meeting, long userId) =>
        Task.FromResult(meeting.HostId == userId || meeting.AllowMiniApp);

    public static void MapMiniAppSessionEndpoints(this WebApplication app)
    {
        // Khong co tang WebSocket de broadcast that su cho ca phong (xem
        // ghi chu trong MeetingsEndpoints.cs/WaitingRoomStore.cs) - endpoint
        // nay chi xac nhan quyen va tra ve 200, KHONG dam bao cac client
        // khac trong phong duoc bao ngay lap tuc. Client hien tai can tu
        // dong bo qua kenh khac (vd tin nhan chat) cho toi khi co WebSocket
        // that.
        app.MapPost("/meetings/{meetingId:long}/mini-app/start", async (
            long meetingId, MiniAppStartRequest? req, ClaimsPrincipal principal, MediaDbContext db) =>
        {
            var meeting = await db.Meetings.FindAsync(meetingId);
            if (meeting is null)
                return Results.NotFound();

            var userId = principal.GetUserId()!.Value;
            if (!await CanUseMiniAppAsync(db, meeting, userId))
                return Results.Json(
                    new ErrorResponse("forbidden", "Khong phai host va khong duoc cap quyen mini_app"),
                    statusCode: 403);

            return Results.Ok(new { appId = req?.AppId ?? "iptv" });
        }).RequireAuthorization();

        app.MapGet("/meetings/{meetingId:long}/mini-app/iptv/stream-url", async (
            long meetingId, long channelId, ClaimsPrincipal principal, MediaDbContext db, MiniAppDbContext miniAppDb) =>
        {
            var meeting = await db.Meetings.FindAsync(meetingId);
            if (meeting is null)
                return Results.NotFound();

            // Bat ky ai DANG trong phong (khong chi host/nguoi duoc cap
            // quyen mini_app) deu goi duoc - dung UC-37 buoc 4: "moi nguoi
            // trong phong TU fetch stream rieng", khong gioi han nguoi khoi
            // dong. Nguoi khong con trong phong (left_at != null) khong goi
            // duoc.
            var userId = principal.GetUserId()!.Value;
            var isInRoom = meeting.HostId == userId || await db.MeetingParticipants
                .AnyAsync(p => p.MeetingId == meetingId && p.UserId == userId && p.LeftAt == null);
            if (!isInRoom)
                return Results.Json(new ErrorResponse("forbidden", "Ban khong o trong phong hop nay"), statusCode: 403);

            var channel = await miniAppDb.IptvChannels.FindAsync(channelId);
            if (channel is null)
                return Results.NotFound();

            return Results.Ok(new StreamUrlResponse(channel.StreamUrl, channel.AudioTrack));
        }).RequireAuthorization();

        // Phat mot link dan thang vao, khong qua danh sach kenh da luu.
        //
        // Duong nay song song voi duong chon-tu-danh-sach chu khong thay the:
        // danh sach la de dung lau, con day la de xem mot lan ("co link tran
        // dau, mo len xem luon").
        //
        // VI SAO PHAI KIEM O SERVER chu khong dan thang xuong trinh phat:
        //  - Rat nhieu URL .m3u8 that ra la DANH SACH hang tram kenh. Dua
        //    thang cho hls.js thi no doc cac URL kenh nhu the chung la segment
        //    cua cung mot luong va phat ra rac. Day dung la lo hong da phai va
        //    o duong nhap playlist (xem MiniAppEndpoints.cs).
        //  - Link sai dinh dang thi trinh phat se chay het 8 luot tu chua (~36
        //    giay) roi moi bao loi, va bao sai nguyen nhan. Chan o day thi
        //    nguoi dan link biet ngay tai sao.
        //
        // Trinh duyet khong tu kiem duoc: may chu IPTV gan nhu khong bao gio
        // gui header CORS cho request kiem tra.
        app.MapPost("/meetings/{meetingId:long}/mini-app/iptv/resolve-direct", async (
            long meetingId, ResolveDirectRequest req, ClaimsPrincipal principal,
            MediaDbContext db, PlaylistFetcher fetcher, CancellationToken ct) =>
        {
            var meeting = await db.Meetings.FindAsync([meetingId], ct);
            if (meeting is null || meeting.Status != MeetingStatus.Active)
                return Results.NotFound();

            var userId = principal.GetUserId()!.Value;
            if (!await CanUseMiniAppAsync(db, meeting, userId))
                return Results.Json(
                    new ErrorResponse("forbidden", "Khong phai host va khong duoc cap quyen mini_app"),
                    statusCode: 403);

            if (string.IsNullOrWhiteSpace(req.Url))
                return Results.BadRequest(new ErrorResponse("invalid_request", "url khong duoc trong"));

            var url = req.Url.Trim();

            // PeekAsync chu khong FetchAsync: chi can vai KB dau de phan loai.
            // Rat nhieu URL IPTV la luong khong bao gio ket thuc, doc het thi
            // vong nao cung cham tran thoi gian - xem PlaylistFetcher.cs.
            var peeked = await fetcher.PeekAsync(url, ct);

            // Bi chan vi an toan (scheme la, dia chi noi bo) thi DUNG HAN o
            // day. Tuyet doi khong duoc noi long: URL nay se duoc phat cho ca
            // phong, nen mot dia chi noi bo se thanh mot lenh do mang LAN tren
            // may cua tung nguoi xem.
            if (peeked.Blocked)
                return Results.UnprocessableEntity(new ErrorResponse("blocked", peeked.Error!));

            // Khong doc duoc vi mang: VAN CHO PHAT, kem canh bao.
            //
            // Ly do: may chu nha nam sau CGNAT va nhieu nguon IPTV chan hoac
            // rat cham voi no, trong khi trinh duyet cua nguoi dung lai vao
            // duoc binh thuong. Do that tren chinh kenh VTV6 cua nguoi dung.
            // Chan cung o day thi tinh nang nay vo dung voi noi dung that cua
            // ho. Viec kiem la de bat cai BAY DA BIET (link that ra la danh
            // sach nhieu kenh), khong phai de lam trong tai cho kha nang ket
            // noi cua may chu.
            if (!peeked.Ok)
                return Results.Ok(new DirectStreamResponse(url, NameFor(req.Name, url), false, peeked.Error));

            var kind = M3uPlaylist.Detect(peeked.Content!);

            if (kind == M3uKind.ChannelList)
            {
                var count = M3uPlaylist.Parse(peeked.Content!, url).Count;
                return Results.UnprocessableEntity(new ErrorResponse(
                    "is_playlist",
                    $"Link nay la danh sach {count}+ kenh chu khong phai mot luong. Hay nhap no vao mot Danh sach kenh roi chon kenh muon xem."));
            }

            // Khong nhan ra la HLS: BAO chu khong CHAN.
            //
            // Do that tren kenh VTV6 cua nguoi dung: nguon do CHONG HOTLINK -
            // voi may chu nha no chuyen huong hai lan roi tra ve mot video moi
            // (ACEClick.mp4, content-type video/mp4), trong khi trinh duyet
            // cua nguoi dung nhan duoc luong that. Khong co cach nao do o phia
            // may chu bat duoc su khac biet do, nen chan cung o day la chan
            // nham chinh noi dung that cua ho.
            //
            // Rieng ChannelList o tren van chan cung, va do la ly do ban dau
            // cua ca buoc kiem nay: mot danh sach kenh thi noi dung DUNG la
            // danh sach - khong the la nan nhan cua chong hotlink.
            if (kind == M3uKind.Unknown)
                return Results.Ok(new DirectStreamResponse(
                    url, NameFor(req.Name, url), false,
                    $"May chu nhan ve {peeked.ContentType ?? "noi dung la"} chu khong phai playlist HLS - co the nguon dang chan may chu (chong hotlink)."));

            return Results.Ok(new DirectStreamResponse(url, NameFor(req.Name, url), true, null));
        }).RequireAuthorization();
    }

    // Ten hien tren khung trinh bay. Nguoi dan link thuong khong buon dat
    // ten, nen doan tu chinh URL: uu tien ten file, khong co thi lay ten
    // mien - van hon la de trong.
    private static string NameFor(string? given, string url)
    {
        if (!string.IsNullOrWhiteSpace(given))
            return given.Trim();

        if (!Uri.TryCreate(url, UriKind.Absolute, out var uri))
            return "Link truc tiep";

        var file = Path.GetFileNameWithoutExtension(uri.AbsolutePath);
        return string.IsNullOrWhiteSpace(file) || file is "index" or "playlist" or "master"
            ? uri.Host
            : file;
    }
}
