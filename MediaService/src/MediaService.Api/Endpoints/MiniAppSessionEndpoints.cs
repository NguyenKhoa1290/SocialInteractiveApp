using System.Security.Claims;
using MediaService.Api.Data;
using MediaService.Api.Models;
using Microsoft.EntityFrameworkCore;

namespace MediaService.Api.Endpoints;

// Phan Mini App gan voi 1 PHIEN HOP cu the (UC-34 cho host, UC-35 cho
// participant duoc cap quyen mini_app).
public static class MiniAppSessionEndpoints
{
    private static async Task<bool> CanUseMiniAppAsync(MediaDbContext db, Meeting meeting, long userId)
    {
        if (meeting.HostId == userId)
            return true;

        return await db.MeetingPermissions.AnyAsync(p =>
            p.MeetingId == meeting.Id && p.UserId == userId && p.PermissionType == PermissionType.MiniApp);
    }

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
    }
}
