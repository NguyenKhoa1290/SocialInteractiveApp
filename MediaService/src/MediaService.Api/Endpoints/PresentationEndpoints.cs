using System.Security.Claims;
using System.Text.Json;
using MediaService.Api.Data;
using MediaService.Api.Models;
using MediaService.Api.Services;
using Microsoft.EntityFrameworkCore;

namespace MediaService.Api.Endpoints;

// FOCUS MODE - "khung trinh bay o trung tam", dung tinh than muc 7.1 cua
// tai lieu goc ("Mini App mo duoi dang mini web trong FOCUS VIEW") va cot
// permission_type co san gia tri 'focus_mode'.
//
// Quy tac cot loi (giong Microsoft Teams): CHI MOT NGUOI duoc trinh bay tai
// mot thoi diem. Ai dang trinh bay ma nguoi khac bam trinh bay thi bi tu
// choi, khong phai "nguoi sau de len nguoi truoc".
//
// Nguon su that la Redis (PresentationStore) chu KHONG phai metadata phong
// LiveKit - moi loi goi LiveKit Cloud tu server nha ton ~1250ms, xem ghi chu
// day du o PresentationStore.cs. Metadata LiveKit van duoc ghi nhung khong
// chan duong tra loi.
public static class PresentationEndpoints
{
    // PresentationState va RoomMetadata nay o Services/PresentationStore.cs.

    private static readonly JsonSerializerOptions JsonOpts = new(JsonSerializerDefaults.Web);


    public static void MapPresentationEndpoints(this WebApplication app)
    {
        var group = app.MapGroup("/meetings/{meetingId:long}/presentation").RequireAuthorization();

        group.MapGet("", async (long meetingId, ClaimsPrincipal principal, MediaDbContext db, PresentationStore store) =>
        {
            var meeting = await db.Meetings.FindAsync(meetingId);
            if (meeting is null)
                return Results.NotFound();

            var callerId = principal.GetUserId()!.Value;
            if (!await IsInRoomAsync(db, meeting, callerId))
                return Results.Json(new ErrorResponse("forbidden", "Ban khong o trong phong hop nay"), statusCode: 403);

            var state = await store.GetAsync(meetingId);
            return state is null ? Results.NoContent() : Results.Ok(state);
        });

        group.MapPost("", async (
            long meetingId, StartPresentationRequest req, ClaimsPrincipal principal,
            MediaDbContext db, LiveKitService liveKit, IdentityClient identity,
            PresentationStore store, ILoggerFactory loggerFactory) =>
        {
            var meeting = await db.Meetings.FindAsync(meetingId);
            if (meeting is null || meeting.Status != MeetingStatus.Active)
                return Results.NotFound();

            var callerId = principal.GetUserId()!.Value;
            if (!await IsInRoomAsync(db, meeting, callerId))
                return Results.Json(new ErrorResponse("forbidden", "Ban khong o trong phong hop nay"), statusCode: 403);

            if (req.Kind is not ("screen" or "mini_app"))
                return Results.BadRequest(new ErrorResponse("invalid_request", "kind phai la screen hoac mini_app"));

            // Quyen tuong ung voi tung loai trinh bay - cap RIENG LE tung
            // tinh nang dung theo tai lieu goc muc 7.1, khong phai
            // all-or-nothing. Quyen nay KHONG dung thay cho quyen kia.
            var needed = req.Kind == "screen" ? PermissionType.ShareScreen : PermissionType.MiniApp;
            var allowed = meeting.HostId == callerId || await db.MeetingPermissions
                .AnyAsync(p => p.MeetingId == meetingId && p.UserId == callerId && p.PermissionType == needed);
            if (!allowed)
                return Results.Json(
                    new ErrorResponse("forbidden", $"Ban chua duoc cap quyen {MeetingPermission.ToStringValue(needed)}"),
                    statusCode: 403);

            var nickname = principal.GetNickname();
            var resolved = await identity.ResolveUserAsync(callerId);
            var state = new PresentationState(
                callerId, resolved?.Nickname ?? nickname, req.Kind, req.AppId, DateTimeOffset.UtcNow);

            // CHI MOT NGUOI trinh bay cung luc. Mot thao tac Redis nguyen tu
            // thay cho doc-roi-ghi tren hai loi goi LiveKit - vua nhanh hon
            // hon 10 lan, vua het canh hai nguoi bam cung luc deu doc thay
            // "chua ai trinh bay" roi cung ghi de len nhau.
            var taken = await store.TryClaimAsync(meetingId, state);
            if (taken is not null)
                return Results.Json(
                    new ErrorResponse("presentation_taken", $"{taken.Nickname} dang trinh bay - chi mot nguoi duoc trinh bay mot luc"),
                    statusCode: 409);

            PushMetadata(liveKit, loggerFactory, meetingId, state);
            return Results.Ok(state);
        });

        group.MapDelete("", async (
            long meetingId, ClaimsPrincipal principal, MediaDbContext db, LiveKitService liveKit,
            PresentationStore store, ILoggerFactory loggerFactory) =>
        {
            var meeting = await db.Meetings.FindAsync(meetingId);
            if (meeting is null)
                return Results.NotFound();

            var callerId = principal.GetUserId()!.Value;
            var current = await store.GetAsync(meetingId);
            if (current is null)
                return Results.NoContent(); // khong ai trinh bay - idempotent

            // Chinh nguoi dang trinh bay, hoac Chu phong (de go ket khi nguoi
            // trinh bay mat mang ma khong kip tat).
            if (current.UserId != callerId && meeting.HostId != callerId)
                return Results.Json(new ErrorResponse("forbidden", "Chi nguoi dang trinh bay hoac Chu phong duoc dung trinh bay"), statusCode: 403);

            await store.ClearAsync(meetingId);
            PushMetadata(liveKit, loggerFactory, meetingId, null);
            return Results.NoContent();
        });
    }

    // Ghi trang thai vao metadata phong LiveKit de moi nguoi DANG O TRONG
    // PHONG nhan duoc su kien RoomMetadataChanged, va nguoi vao muon doc duoc
    // tu room.metadata luc ket noi.
    //
    // KHONG await: loi goi nay ton ~1250ms va nguoi bam nut khong can cho no.
    // Ho publish track ngay duoc; nhung nguoi khac thay chuyen focus sau
    // khoang 1 giay - dung luc luong video that su toi noi.
    //
    // Nuot loi va ghi log: Redis moi la nguon su that, hong buoc nay chi lam
    // cham viec chuyen focus chu khong lam sai trang thai.
    private static void PushMetadata(LiveKitService liveKit, ILoggerFactory loggerFactory, long meetingId, PresentationState? state)
    {
        var logger = loggerFactory.CreateLogger(typeof(PresentationEndpoints));
        var json = JsonSerializer.Serialize(new RoomMetadata(state), JsonOpts);
        _ = Task.Run(async () =>
        {
            try
            {
                await liveKit.SetRoomMetadataAsync(meetingId, json);
            }
            catch (Exception ex)
            {
                logger.LogWarning(ex, "Khong ghi duoc metadata trinh bay cho cuoc hop {MeetingId}", meetingId);
            }
        });
    }

    private static async Task<bool> IsInRoomAsync(MediaDbContext db, Meeting meeting, long userId) =>
        meeting.HostId == userId || await db.MeetingParticipants
            .AnyAsync(p => p.MeetingId == meeting.Id && p.UserId == userId && p.LeftAt == null);
}

public record StartPresentationRequest(string Kind, string? AppId);
