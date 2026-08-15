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
// Trang thai luu trong metadata cua phong ben LiveKit chu khong phai bang
// rieng - xem ghi chu trong LiveKitService.GetRoomMetadataAsync.
public static class PresentationEndpoints
{
    // Hinh dang metadata phong: {"presentation": {...}} hoac {} khi khong ai
    // trinh bay. Giu dang object long nhau de sau nay them truong khac vao
    // metadata phong ma khong pha vo client cu.
    // Kind: screen (chia se man hinh) hoac mini_app (IPTV...).
    //
    // CO Y KHONG co kind "ghim nguoi vao giua": ghim la LUA CHON XEM RIENG
    // cua tung nguoi, xu ly hoan toan o Frontend, khong gui len server va
    // khong ap cho ai khac. Chi nhung thu THUC SU dung chung (man hinh dang
    // chia se, mini app dang mo) moi can trang thai o server.
    public record PresentationState(long UserId, string Nickname, string Kind, string? AppId, DateTimeOffset StartedAt);
    public record RoomMetadata(PresentationState? Presentation);

    private static readonly JsonSerializerOptions JsonOpts = new(JsonSerializerDefaults.Web);

    internal static PresentationState? ReadPresentation(string? metadata)
    {
        if (string.IsNullOrWhiteSpace(metadata))
            return null;
        try
        {
            return JsonSerializer.Deserialize<RoomMetadata>(metadata, JsonOpts)?.Presentation;
        }
        catch (JsonException)
        {
            // Metadata hong/khong dung dinh dang -> coi nhu khong ai trinh bay,
            // khong duoc nem loi lam chet ca cuoc hop.
            return null;
        }
    }

    public static void MapPresentationEndpoints(this WebApplication app)
    {
        var group = app.MapGroup("/meetings/{meetingId:long}/presentation").RequireAuthorization();

        group.MapGet("", async (long meetingId, ClaimsPrincipal principal, MediaDbContext db, LiveKitService liveKit) =>
        {
            var meeting = await db.Meetings.FindAsync(meetingId);
            if (meeting is null)
                return Results.NotFound();

            var callerId = principal.GetUserId()!.Value;
            if (!await IsInRoomAsync(db, meeting, callerId))
                return Results.Json(new ErrorResponse("forbidden", "Ban khong o trong phong hop nay"), statusCode: 403);

            var state = ReadPresentation(await liveKit.GetRoomMetadataAsync(meetingId));
            return state is null ? Results.NoContent() : Results.Ok(state);
        });

        group.MapPost("", async (
            long meetingId, StartPresentationRequest req, ClaimsPrincipal principal,
            MediaDbContext db, LiveKitService liveKit, IdentityClient identity) =>
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

            // CHI MOT NGUOI trinh bay cung luc. Nguoi dang trinh bay bam lai
            // thi coi nhu doi noi dung (vd tu chia se man hinh sang mini app)
            // - khong chan chinh minh.
            var current = ReadPresentation(await liveKit.GetRoomMetadataAsync(meetingId));
            if (current is not null && current.UserId != callerId)
                return Results.Json(
                    new ErrorResponse("presentation_taken", $"{current.Nickname} dang trinh bay - chi mot nguoi duoc trinh bay mot luc"),
                    statusCode: 409);

            var nickname = principal.GetNickname();
            var resolved = await identity.ResolveUserAsync(callerId);
            var state = new PresentationState(
                callerId, resolved?.Nickname ?? nickname, req.Kind, req.AppId, DateTimeOffset.UtcNow);

            await liveKit.SetRoomMetadataAsync(meetingId, JsonSerializer.Serialize(new RoomMetadata(state), JsonOpts));
            return Results.Ok(state);
        });

        group.MapDelete("", async (long meetingId, ClaimsPrincipal principal, MediaDbContext db, LiveKitService liveKit) =>
        {
            var meeting = await db.Meetings.FindAsync(meetingId);
            if (meeting is null)
                return Results.NotFound();

            var callerId = principal.GetUserId()!.Value;
            var current = ReadPresentation(await liveKit.GetRoomMetadataAsync(meetingId));
            if (current is null)
                return Results.NoContent(); // khong ai trinh bay - idempotent

            // Chinh nguoi dang trinh bay, hoac Chu phong (de go ket khi nguoi
            // trinh bay mat mang ma khong kip tat).
            if (current.UserId != callerId && meeting.HostId != callerId)
                return Results.Json(new ErrorResponse("forbidden", "Chi nguoi dang trinh bay hoac Chu phong duoc dung trinh bay"), statusCode: 403);

            await liveKit.SetRoomMetadataAsync(meetingId, JsonSerializer.Serialize(new RoomMetadata(null), JsonOpts));
            return Results.NoContent();
        });
    }

    private static async Task<bool> IsInRoomAsync(MediaDbContext db, Meeting meeting, long userId) =>
        meeting.HostId == userId || await db.MeetingParticipants
            .AnyAsync(p => p.MeetingId == meeting.Id && p.UserId == userId && p.LeftAt == null);
}

public record StartPresentationRequest(string Kind, string? AppId);
