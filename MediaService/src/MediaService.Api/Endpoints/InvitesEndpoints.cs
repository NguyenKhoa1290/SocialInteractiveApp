using System.Security.Claims;
using MediaService.Api.Data;
using MediaService.Api.Models;
using MediaService.Api.Services;
using Microsoft.EntityFrameworkCore;

namespace MediaService.Api.Endpoints;

// UC-32, UC-33.
public static class InvitesEndpoints
{
    public static void MapInvitesEndpoints(this WebApplication app)
    {
        app.MapPost("/meetings/{meetingId:long}/invites", async (
            long meetingId, CreateInviteRequest req, ClaimsPrincipal principal,
            MediaDbContext db, IdentityClient identity, ChatServiceClient chat, PublicWebOptions web) =>
        {
            var meeting = await db.Meetings.FindAsync(meetingId);
            if (meeting is null || meeting.Status != MeetingStatus.Active)
                return Results.NotFound();

            var callerId = principal.GetUserId()!.Value;
            var type = req.Type == "direct" ? InviteType.Direct : InviteType.Link;

            if (type == InviteType.Direct)
            {
                if (req.InvitedUserId is null)
                    return Results.BadRequest(new ErrorResponse("invalid_request", "invitedUserId bat buoc khi type=direct"));

                var invitedUser = await identity.ResolveUserAsync(req.InvitedUserId.Value);
                if (invitedUser is null)
                    return Results.UnprocessableEntity(new ErrorResponse("user_not_found", "invitedUserId khong ton tai"));

                // UC-32: chi moi duoc BAN BE. Rang buoc nay tung bi bo qua vi
                // luc viet Media Service he thong chua co tinh nang ket ban -
                // gio Identity Service da co bang friendships nen cai lai
                // cho dung dac ta.
                // 422 chu khong phai 403 - dung theo hop dong da ghi trong
                // Tainguyen/media-service-api.yaml (UC-32, luong ngoai le 1c).
                if (!await identity.AreFriendsAsync(callerId, req.InvitedUserId.Value))
                    return Results.UnprocessableEntity(
                        new ErrorResponse("not_friends", "Chi moi truc tiep duoc nguoi da la ban be"));
            }

            var invite = new MeetingInvite
            {
                MeetingId = meetingId,
                InviteToken = Guid.NewGuid().ToString("N"),
                InviteType = type,
                CreatedBy = callerId,
                InvitedUserId = type == InviteType.Direct ? req.InvitedUserId : null,
                ExpiresAt = DateTimeOffset.UtcNow.AddHours(24),
                CreatedAt = DateTimeOffset.UtcNow,
            };
            db.MeetingInvites.Add(invite);
            await db.SaveChangesAsync();

            // Bao cho nguoi duoc moi bang chinh khung chat 1-1 cua hai nguoi.
            // Truoc day cho nay publish mot su kien RabbitMQ de Identity day
            // notification, nhung khong service nao consume ca - loi moi roi
            // vao hu khong. Tin nhan he thong thi den ngay (Chat Service phat
            // qua SignalR) va con luu lai de doc sau.
            //
            // Khong chan luong chinh neu buoc nay hong: loi moi da tao xong,
            // nguoi moi van copy link gui tay duoc.
            if (type == InviteType.Direct)
            {
                var conversationId = await chat.GetOrCreateP2PAsync(callerId, req.InvitedUserId!.Value);
                if (conversationId is not null)
                {
                    var nickname = principal.GetNickname();
                    var link = $"{web.BaseUrl}/meetings/join/{invite.InviteToken}";
                    await chat.PostSystemMessageAsync(conversationId.Value,
                        $"{nickname} moi ban vao cuoc hop: {link}");
                }
            }

            return Results.Created($"/meetings/{meetingId}/invites/{invite.Id}", InviteResponse.FromEntity(invite));
        }).RequireAuthorization();

        app.MapGet("/meetings/join/{inviteToken}", async (
            string inviteToken, MediaDbContext db, IdentityClient identity) =>
        {
            var invite = await db.MeetingInvites.FirstOrDefaultAsync(i => i.InviteToken == inviteToken);
            if (invite is null || (invite.ExpiresAt is not null && invite.ExpiresAt < DateTimeOffset.UtcNow))
                return Results.NotFound();

            var meeting = await db.Meetings.Include(m => m.Participants).FirstOrDefaultAsync(m => m.Id == invite.MeetingId);
            if (meeting is null || meeting.Status != MeetingStatus.Active)
                return Results.NotFound();

            var host = await identity.ResolveUserAsync(meeting.HostId);
            var activeCount = meeting.Participants.Count(p => p.LeftAt == null);

            // Quyet dinh tu thiet ke (khong co cot rieng trong schema
            // "meetings" cho requiresApproval): link invite luon can duyet
            // (host chua biet truoc ai se bam vao link), direct invite thi
            // KHONG can duyet vi host da chu dong chon dung nguoi do roi.
            var requiresApproval = invite.InviteType == InviteType.Link;

            return Results.Ok(new MeetingPreviewResponse(
                meeting.Id, host?.Nickname ?? $"user_{meeting.HostId}", activeCount, requiresApproval));
        });

        app.MapPost("/meetings/join/{inviteToken}", async (
            string inviteToken, JoinMeetingRequest? req, ClaimsPrincipal principal,
            MediaDbContext db, LiveKitService liveKit, WaitingRoomStore waiting, IdentityClient identity) =>
        {
            var invite = await db.MeetingInvites.FirstOrDefaultAsync(i => i.InviteToken == inviteToken);
            if (invite is null || (invite.ExpiresAt is not null && invite.ExpiresAt < DateTimeOffset.UtcNow))
                return Results.NotFound();

            var meeting = await db.Meetings.Include(m => m.Participants).FirstOrDefaultAsync(m => m.Id == invite.MeetingId);
            if (meeting is null || meeting.Status != MeetingStatus.Active)
                return Results.NotFound();

            var callerId = principal.GetUserId()!.Value;

            if (invite.InviteType == InviteType.Direct && invite.InvitedUserId != callerId)
                return Results.Json(new ErrorResponse("forbidden", "Loi moi nay khong danh cho ban"), statusCode: 403);

            var existing = meeting.Participants.FirstOrDefault(p => p.UserId == callerId && p.LeftAt == null);
            if (existing is not null)
            {
                var rejoinToken = liveKit.GenerateAccessToken(
                    meeting.Id, callerId, req?.Nickname ?? principal.GetNickname(),
                    (await identity.ResolveUserDetailAsync(callerId))?.Email,
                    TimeSpan.FromHours(6));
                return Results.Ok(new JoinResultResponse("approved", rejoinToken, liveKit.ClientUrl, meeting.Id));
            }

            var activeCount = meeting.Participants.Count(p => p.LeftAt == null);
            if (activeCount >= meeting.MaxParticipants)
                return Results.Json(new ErrorResponse("room_full", "Phong da dat gioi han so nguoi"), statusCode: 409);

            var nickname = req?.Nickname ?? principal.GetNickname();
            var requiresApproval = invite.InviteType == InviteType.Link;

            if (requiresApproval)
            {
                await waiting.AddAsync(meeting.Id, callerId, nickname);
                return Results.Ok(new JoinResultResponse("pending", null, null, meeting.Id));
            }

            db.MeetingParticipants.Add(new MeetingParticipant
            {
                MeetingId = meeting.Id,
                UserId = callerId,
                Role = ParticipantRole.Participant,
                JoinedAt = DateTimeOffset.UtcNow,
            });
            await db.SaveChangesAsync();

            var email = (await identity.ResolveUserDetailAsync(callerId))?.Email;
            var token = liveKit.GenerateAccessToken(meeting.Id, callerId, nickname, email, TimeSpan.FromHours(6));
            return Results.Ok(new JoinResultResponse("approved", token, liveKit.ClientUrl, meeting.Id));
        }).RequireAuthorization();
    }
}
