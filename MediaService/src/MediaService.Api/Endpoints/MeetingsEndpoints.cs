using MediaService.Api.Data;
using MediaService.Api.Models;
using MediaService.Api.Services;
using Microsoft.EntityFrameworkCore;
using StackExchange.Redis;

namespace MediaService.Api.Endpoints;

// UC-31, UC-34 (phan mo/xem/ket thuc hop).
public static class MeetingsEndpoints
{
    public static void MapMeetingsEndpoints(this WebApplication app)
    {
        var group = app.MapGroup("/meetings").RequireAuthorization();

        group.MapPost("", async (
            CreateMeetingRequest req, System.Security.Claims.ClaimsPrincipal principal,
            MediaDbContext db, LiveKitService liveKit, ChatServiceClient chat) =>
        {
            var hostId = principal.GetUserId()!.Value;

            if (req.Mode == "in_chat" && req.ConversationId is null)
                return Results.BadRequest(new ErrorResponse("invalid_request", "conversationId bat buoc khi mode=in_chat"));

            var meeting = new Meeting
            {
                HostId = hostId,
                ConversationId = req.Mode == "in_chat" ? req.ConversationId : null,
                Status = MeetingStatus.Active,
                MaxParticipants = 100,
                CreatedAt = DateTimeOffset.UtcNow,
            };
            db.Meetings.Add(meeting);
            await db.SaveChangesAsync();

            db.MeetingParticipants.Add(new MeetingParticipant
            {
                MeetingId = meeting.Id,
                UserId = hostId,
                Role = ParticipantRole.Host,
                JoinedAt = DateTimeOffset.UtcNow,
            });
            await db.SaveChangesAsync();

            try
            {
                await liveKit.CreateRoomAsync(meeting.Id, meeting.MaxParticipants);
            }
            catch (Exception)
            {
                // Cum LiveKit da day (UC-31, luong ngoai le 2a) - don meeting
                // vua tao trong Media DB de tranh rac du lieu "phong ma" khong
                // co room LiveKit tuong ung.
                db.Meetings.Remove(meeting);
                await db.SaveChangesAsync();
                return Results.Json(
                    new ErrorResponse("livekit_unavailable", "Cum LiveKit hien da dat gioi han, thu lai sau"),
                    statusCode: 503);
            }

            if (req.Mode == "in_chat" && req.ConversationId is not null)
            {
                var nickname = principal.GetNickname();
                await chat.PostSystemMessageAsync(req.ConversationId.Value, $"{nickname} da mo cuoc hop");
            }

            return Results.Created($"/meetings/{meeting.Id}", MeetingResponse.FromEntity(meeting));
        });

        group.MapGet("/{meetingId:long}", async (
            long meetingId, System.Security.Claims.ClaimsPrincipal principal,
            MediaDbContext db, WaitingRoomStore waiting, IConnectionMultiplexer redis, LiveKitService liveKit) =>
        {
            var meeting = await db.Meetings.Include(m => m.Participants).FirstOrDefaultAsync(m => m.Id == meetingId);
            if (meeting is null)
                return Results.NotFound();

            var callerId = principal.GetUserId()!.Value;
            var participant = meeting.Participants.FirstOrDefault(p => p.UserId == callerId && p.LeftAt == null);

            string callerStatus;
            string? livekitToken = null;
            string? livekitUrl = null;

            // Kiem tra token dang cho lay TRUOC TIEN (vua duoc duyet, xem
            // ParticipantsEndpoints.cs Approve) - tieu thu 1 lan. PHAI kiem
            // tra truoc nhanh "da la participant", vi luc duoc duyet thi
            // dong thoi DA insert xong meeting_participants NEN nhanh do se
            // luon dung truoc va "nuot mat" token neu kiem tra sau (bug thuc
            // te phat hien khi test: nguoi vua duoc duyet khong bao gio nhan
            // duoc token vi callerStatus da la "participant" tu vong poll dau).
            var db0 = redis.GetDatabase();
            var tokenKey = $"meeting:{meetingId}:token:{callerId}";
            var pendingToken = await db0.StringGetAsync(tokenKey);

            if (!pendingToken.IsNullOrEmpty)
            {
                await db0.KeyDeleteAsync(tokenKey);
                callerStatus = "approved";
                livekitToken = pendingToken.ToString();
                livekitUrl = liveKit.ClientUrl;
            }
            else if (participant is not null)
            {
                callerStatus = participant.Role == ParticipantRole.Host ? "host" : "participant";
            }
            else if (await waiting.IsWaitingAsync(meetingId, callerId))
            {
                callerStatus = "pending";
            }
            else if (await waiting.ConsumeDeniedAsync(meetingId, callerId))
            {
                callerStatus = "denied";
            }
            else
            {
                callerStatus = "not_joined";
            }

            return Results.Ok(MeetingWithCallerStatusResponse.From(meeting, callerStatus, livekitToken, livekitUrl));
        });

        group.MapPost("/{meetingId:long}/end", async (
            long meetingId, System.Security.Claims.ClaimsPrincipal principal,
            MediaDbContext db, LiveKitService liveKit, WaitingRoomStore waiting) =>
        {
            var meeting = await db.Meetings.FindAsync(meetingId);
            if (meeting is null)
                return Results.NotFound();

            var callerId = principal.GetUserId()!.Value;
            if (meeting.HostId != callerId)
                return Results.Json(new ErrorResponse("forbidden", "Chi Chu phong hop duoc ket thuc"), statusCode: 403);

            meeting.Status = MeetingStatus.Ended;
            meeting.EndedAt = DateTimeOffset.UtcNow;
            await db.SaveChangesAsync();

            try { await liveKit.DeleteRoomAsync(meetingId); } catch (Exception) { /* room co the da tu don vi het nguoi */ }
            await waiting.ClearMeetingAsync(meetingId);

            return Results.NoContent();
        });
    }
}
