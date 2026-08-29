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
            MediaDbContext db, IdentityClient identity, MeetingInviteNotificationPublisher publisher) =>
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

            // Bao cho nguoi duoc moi qua Identity Service - dau moi
            // notification cua ca he thong (roadmap muc 1, bang muc 8.1):
            // Media publish vao RabbitMQ, Identity luu lai roi day tiep xuong
            // dung nguoi do qua WebSocket.
            //
            // Ban truoc tung dat tin nhan he thong vao khung chat 1-1 thay
            // cho viec nay, luc he thong chua co tang notification. Gio da co
            // thi giu ca hai la bao trung mot su kien tren hai duong.
            if (type == InviteType.Direct)
                await publisher.PublishAsync(meetingId, req.InvitedUserId!.Value, callerId, invite.InviteToken, principal.GetNickname());

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

            // Loi moi TRUC TIEP van khong bao gio phai duyet - host da chu
            // dong chon dung nguoi do roi. Loi moi bang LINK thi hoi cong tac
            // cua chinh cuoc hop (meetings.requires_approval) chu khong con
            // suy ra cung nhac tu kieu loi moi: host bat/tat duoc giua chung.
            var requiresApproval = invite.InviteType == InviteType.Link && meeting.RequiresApproval;

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
                var (rejoinMic, rejoinCam, rejoinShare) = await ParticipantsEndpoints.LoadPublishFlagsAsync(db, meeting.Id, callerId);
                var rejoinToken = liveKit.GenerateAccessToken(
                    meeting.Id, callerId, req?.Nickname ?? principal.GetNickname(),
                    (await identity.ResolveUserDetailAsync(callerId))?.Email,
                    TimeSpan.FromHours(6), rejoinMic, rejoinCam, rejoinShare);
                return Results.Ok(new JoinResultResponse("approved", rejoinToken, liveKit.ClientUrl, meeting.Id));
            }

            var activeCount = meeting.Participants.Count(p => p.LeftAt == null);
            if (activeCount >= meeting.MaxParticipants)
                return Results.Json(new ErrorResponse("room_full", "Phong da dat gioi han so nguoi"), statusCode: 409);

            var nickname = req?.Nickname ?? principal.GetNickname();
            // Cung quy tac voi phan xem truoc o tren - phai giong nhau, khong
            // thi nguoi dung thay "vao thang duoc" roi lai bi day vao phong cho.
            var requiresApproval = invite.InviteType == InviteType.Link && meeting.RequiresApproval;

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
            var (micOk, camOk, shareOk) = await ParticipantsEndpoints.LoadPublishFlagsAsync(db, meeting.Id, callerId);
            var token = liveKit.GenerateAccessToken(
                meeting.Id, callerId, nickname, email, TimeSpan.FromHours(6), micOk, camOk, shareOk);
            return Results.Ok(new JoinResultResponse("approved", token, liveKit.ClientUrl, meeting.Id));
        }).RequireAuthorization();
    }
}
