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
            var token = liveKit.GenerateAccessToken(meetingId, userId, entry.Nickname, email, TimeSpan.FromHours(6));

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
            long meetingId, long userId, GrantPermissionRequest req, ClaimsPrincipal principal, MediaDbContext db) =>
        {
            var (meeting, error) = await RequireHostAsync(meetingId, principal, db);
            if (error is not null) return error;

            PermissionType permType;
            try { permType = MeetingPermission.FromString(req.PermissionType); }
            catch (ArgumentException) { return Results.BadRequest(new ErrorResponse("invalid_request", "permissionType khong hop le")); }

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

            return Results.Created($"/meetings/{meetingId}/participants/{userId}/permissions", null);
        });

        group.MapDelete("/participants/{userId:long}/permissions", async (
            long meetingId, long userId, string permissionType, ClaimsPrincipal principal, MediaDbContext db) =>
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

            return Results.NoContent();
        });
    }
}
