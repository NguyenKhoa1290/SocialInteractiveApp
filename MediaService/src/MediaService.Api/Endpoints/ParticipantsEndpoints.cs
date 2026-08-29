using System.Security.Claims;
using MediaService.Api.Data;
using MediaService.Api.Models;
using MediaService.Api.Services;
using Microsoft.EntityFrameworkCore;
using StackExchange.Redis;

namespace MediaService.Api.Endpoints;

// UC-33 buoc 3, UC-34, UC-35.
public static class ParticipantsEndpoints
{
    private static async Task<(Meeting? meeting, IResult? error)> RequireHostAsync(
        long meetingId, ClaimsPrincipal principal, MediaDbContext db)
    {
        var meeting = await db.Meetings.FindAsync(meetingId);
        if (meeting is null)
            return (null, Results.NotFound());

        var callerId = principal.GetUserId()!.Value;
        if (meeting.HostId != callerId)
            return (null, Results.Json(new ErrorResponse("forbidden", "Chi Chu phong hop duoc thuc hien thao tac nay"), statusCode: 403));

        return (meeting, null);
    }

    public static void MapParticipantsEndpoints(this WebApplication app)
    {
        var group = app.MapGroup("/meetings/{meetingId:long}").RequireAuthorization();

        // Thieu sot phat hien khi build Frontend F5: da co API kick/cap quyen
        // theo userId nhung khong co cach nao LIET KE ai dang o trong phong
        // de bam. Ai dang o trong phong deu xem duoc (khong chi host) - danh
        // sach nguoi cung phong khong phai thong tin quan tri.
        group.MapGet("/participants", async (
            long meetingId, ClaimsPrincipal principal, MediaDbContext db,
            IdentityClient identity, ParticipantReconciler reconciler) =>
        {
            var meeting = await db.Meetings.FindAsync(meetingId);
            if (meeting is null)
                return Results.NotFound();

            var callerId = principal.GetUserId()!.Value;

            // Doi chieu voi danh sach nguoi THAT SU dang ket noi ben LiveKit
            // truoc khi tra loi: dong tab khong goi /leave nen bang nay tu no
            // khong bao gio tu sach. Xem ParticipantReconciler.cs - no tu
            // chan tan suat va tu bo qua khi khong chac chan.
            if (meeting.Status == MeetingStatus.Active)
                await reconciler.ReconcileAsync(meetingId, callerId, db);

            var active = await db.MeetingParticipants
                .Where(p => p.MeetingId == meetingId && p.LeftAt == null)
                .ToListAsync();

            if (meeting.HostId != callerId && !active.Any(p => p.UserId == callerId))
                return Results.Json(new ErrorResponse("forbidden", "Ban khong o trong phong hop nay"), statusCode: 403);

            var permissions = await db.MeetingPermissions.Where(p => p.MeetingId == meetingId).ToListAsync();
            var users = await identity.ResolveUsersAsync(active.Select(p => p.UserId));

            return Results.Ok(active.Select(p => new MeetingParticipantResponse(
                p.UserId,
                users.TryGetValue(p.UserId, out var u) ? u.Nickname : $"user_{p.UserId}",
                p.Role == ParticipantRole.Host ? "host" : "participant",
                p.JoinedAt,
                [.. permissions.Where(x => x.UserId == p.UserId).Select(x => MeetingPermission.ToStringValue(x.PermissionType))])));
        });

        group.MapGet("/waiting-room", async (long meetingId, ClaimsPrincipal principal, MediaDbContext db, WaitingRoomStore waiting) =>
        {
            var (_, error) = await RequireHostAsync(meetingId, principal, db);
            if (error is not null) return error;

            var list = await waiting.ListAsync(meetingId);
            return Results.Ok(list.Select(e => new WaitingParticipantResponse(e.UserId, e.Nickname, e.RequestedAt)));
        });

        group.MapPost("/waiting-room/{userId:long}/approve", async (
            long meetingId, long userId, ClaimsPrincipal principal,
            MediaDbContext db, WaitingRoomStore waiting, LiveKitService liveKit, IdentityClient identity, IConnectionMultiplexer redis) =>
        {
            var (meeting, error) = await RequireHostAsync(meetingId, principal, db);
            if (error is not null) return error;

            if (!await waiting.IsWaitingAsync(meetingId, userId))
                return Results.NotFound();

            var waitingList = await waiting.ListAsync(meetingId);
            var entry = waitingList.First(e => e.UserId == userId);
            await waiting.RemoveAsync(meetingId, userId);

            db.MeetingParticipants.Add(new MeetingParticipant
            {
                MeetingId = meetingId,
                UserId = userId,
                Role = ParticipantRole.Participant,
                JoinedAt = DateTimeOffset.UtcNow,
            });
            await db.SaveChangesAsync();

            var email = (await identity.ResolveUserDetailAsync(userId))?.Email;
            // Quyen mic/camera bam theo cap (meeting, user) nen van con nguyen
            // neu nguoi nay tung bi thu quyen roi roi phong va quay lai.
            var (micOk, camOk, shareOk) = await LoadPublishFlagsAsync(db, meetingId, userId);
            var token = liveKit.GenerateAccessToken(
                meetingId, userId, entry.Nickname, email, TimeSpan.FromHours(6), micOk, camOk, shareOk);

            // Chua co WebSocket (xem ghi chu trong WaitingRoomStore.cs) - luu
            // token tam vao Redis de nguoi duoc duyet lay o lan poll
            // GET /meetings/{meetingId} tiep theo.
            var db0 = redis.GetDatabase();
            await db0.StringSetAsync($"meeting:{meetingId}:token:{userId}", token, TimeSpan.FromMinutes(5));

            return Results.Ok();
        });

        group.MapPost("/waiting-room/{userId:long}/deny", async (
            long meetingId, long userId, ClaimsPrincipal principal, MediaDbContext db, WaitingRoomStore waiting) =>
        {
            var (_, error) = await RequireHostAsync(meetingId, principal, db);
            if (error is not null) return error;

            if (!await waiting.IsWaitingAsync(meetingId, userId))
                return Results.NotFound();

            await waiting.MarkDeniedAsync(meetingId, userId);
            return Results.NoContent();
        });

        group.MapPost("/participants/{userId:long}/kick", async (
            long meetingId, long userId, ClaimsPrincipal principal,
            MediaDbContext db, LiveKitService liveKit) =>
        {
            var (meeting, error) = await RequireHostAsync(meetingId, principal, db);
            if (error is not null) return error;

            var participant = await db.MeetingParticipants
                .FirstOrDefaultAsync(p => p.MeetingId == meetingId && p.UserId == userId && p.LeftAt == null);
            if (participant is null)
                return Results.NotFound();

            try { await liveKit.RemoveParticipantAsync(meetingId, userId); } catch (Exception) { /* co the da roi phong o phia LiveKit */ }

            participant.LeftAt = DateTimeOffset.UtcNow;
            await db.SaveChangesAsync(); // trigger trg_close_meeting_if_empty tu dong dong phong neu day la nguoi cuoi

            return Results.NoContent();
        });

        group.MapPost("/participants/{userId:long}/permissions", async (
            long meetingId, long userId, GrantPermissionRequest req, ClaimsPrincipal principal,
            MediaDbContext db, LiveKitService liveKit) =>
        {
            var (meeting, error) = await RequireHostAsync(meetingId, principal, db);
            if (error is not null) return error;

            PermissionType permType;
            try { permType = MeetingPermission.FromString(req.PermissionType); }
            catch (ArgumentException) { return Results.BadRequest(new ErrorResponse("invalid_request", "permissionType khong hop le")); }

            // Chu phong tu thu mic cua chinh minh la trang thai vo nghia (tu
            // bam la tu mo lai duoc) - chan cho gon.
            if (IsPublishDenial(permType) && userId == meeting!.HostId)
                return Results.BadRequest(new ErrorResponse("invalid_request", "Khong the thu quyen mic/camera cua chinh chu phong"));

            var already = await db.MeetingPermissions.AnyAsync(p =>
                p.MeetingId == meetingId && p.UserId == userId && p.PermissionType == permType);
            if (!already)
            {
                db.MeetingPermissions.Add(new MeetingPermission
                {
                    MeetingId = meetingId,
                    UserId = userId,
                    PermissionType = permType,
                    GrantedBy = meeting!.HostId,
                    GrantedAt = DateTimeOffset.UtcNow,
                });
                await db.SaveChangesAsync();
            }

            if (IsPublishDenial(permType))
                await SyncPublishPermissionsAsync(meetingId, userId, db, liveKit);

            return Results.Created($"/meetings/{meetingId}/participants/{userId}/permissions", null);
        });

        group.MapDelete("/participants/{userId:long}/permissions", async (
            long meetingId, long userId, string permissionType, ClaimsPrincipal principal,
            MediaDbContext db, LiveKitService liveKit) =>
        {
            var (_, error) = await RequireHostAsync(meetingId, principal, db);
            if (error is not null) return error;

            PermissionType permType;
            try { permType = MeetingPermission.FromString(permissionType); }
            catch (ArgumentException) { return Results.BadRequest(new ErrorResponse("invalid_request", "permissionType khong hop le")); }

            var perm = await db.MeetingPermissions.FirstOrDefaultAsync(p =>
                p.MeetingId == meetingId && p.UserId == userId && p.PermissionType == permType);
            if (perm is not null)
            {
                db.MeetingPermissions.Remove(perm);
                await db.SaveChangesAsync();
            }

            if (IsPublishDenial(permType))
                await SyncPublishPermissionsAsync(meetingId, userId, db, liveKit);

            return Results.NoContent();
        });
    }

    private static bool IsPublishDenial(PermissionType t) =>
        t is PermissionType.NoMic or PermissionType.NoCamera or PermissionType.NoScreenShare;

    // Doc lai trang thai cam trong DB roi day sang LiveKit.
    //
    // Ghi vao DB thoi la CHUA DU: DB chi duoc doc luc sinh token, tuc la lan
    // vao phong TIEP THEO. Nguoi dang ngoi trong phong van noi binh thuong.
    // LiveKit moi la cho cuong che duoc ngay lap tuc.
    private static async Task SyncPublishPermissionsAsync(
        long meetingId, long userId, MediaDbContext db, LiveKitService liveKit)
    {
        var (micAllowed, camAllowed, shareAllowed) = await LoadPublishFlagsAsync(db, meetingId, userId);

        try
        {
            await liveKit.ApplyPublishPermissionsAsync(meetingId, userId, micAllowed, camAllowed, shareAllowed);
        }
        catch (Exception)
        {
            // Nguoi do co the vua roi phong. Quyen da nam trong DB nen lan
            // vao sau van bi chan qua token.
        }

        // Doi quyen chi chan lan publish sau - track dang phat phai tat rieng.
        await liveKit.MutePublishedAsync(meetingId, userId, !micAllowed, !camAllowed);
    }

    // Dung chung ca luc sinh token. Hai tang chong len nhau:
    //   1. MAC DINH CUA PHONG (meetings.allow_mic / allow_camera) - "Cai dat
    //      phong", ap cho moi nguoi, ke ca nguoi vao sau.
    //   2. RIENG TUNG NGUOI: mot hang no_mic / no_camera trong
    //      meeting_permissions de bep len tren (xem MeetingPermission.cs).
    //
    // Chu phong LUON duoc phep: cong tac cua phong la thu ong ta cam, bam
    // nham mot cai ma tu khoa mieng minh thi khong con duong mo lai.
    public static async Task<(bool MicAllowed, bool CamAllowed, bool ShareAllowed)> LoadPublishFlagsAsync(
        MediaDbContext db, long meetingId, long userId)
    {
        var phong = await db.Meetings
            .Where(m => m.Id == meetingId)
            .Select(m => new { m.HostId, m.AllowMic, m.AllowCamera, m.AllowScreenShare })
            .FirstOrDefaultAsync();

        if (phong is null)
            return (true, true, true);
        if (phong.HostId == userId)
            return (true, true, true);

        var denied = await db.MeetingPermissions
            .Where(p => p.MeetingId == meetingId && p.UserId == userId &&
                        (p.PermissionType == PermissionType.NoMic ||
                         p.PermissionType == PermissionType.NoCamera ||
                         p.PermissionType == PermissionType.NoScreenShare))
            .Select(p => p.PermissionType)
            .ToListAsync();

        return (
            phong.AllowMic && !denied.Contains(PermissionType.NoMic),
            phong.AllowCamera && !denied.Contains(PermissionType.NoCamera),
            phong.AllowScreenShare && !denied.Contains(PermissionType.NoScreenShare));
    }

    // Ap lai quyen phat cho MOI NGUOI dang trong phong. Dung khi chu phong
    // doi mot cong tac cua ca phong - doi mot dong trong DB thi nguoi dang
    // ngoi trong phong van noi binh thuong, phai day sang LiveKit tung nguoi.
    public static async Task SyncAllPublishPermissionsAsync(
        long meetingId, MediaDbContext db, LiveKitService liveKit)
    {
        var dangO = await db.MeetingParticipants
            .Where(p => p.MeetingId == meetingId && p.LeftAt == null)
            .Select(p => p.UserId)
            .ToListAsync();

        foreach (var userId in dangO)
            await SyncPublishPermissionsAsync(meetingId, userId, db, liveKit);
    }
}
