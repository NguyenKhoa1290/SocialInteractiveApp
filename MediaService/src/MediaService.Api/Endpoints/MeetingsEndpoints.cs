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

            // UC-31 buoc 4 ("publish su kien tao phong de day notification")
            // duoc dap ung bang chinh tin nhan he thong o tren, khong qua
            // RabbitMQ nua - xem ghi chu day du o Program.cs.

            return Results.Created($"/meetings/{meeting.Id}", MeetingResponse.FromEntity(meeting));
        });

        // Thieu sot phat hien khi build Frontend F5: khi host mo hop voi
        // mode=in_chat, Chat Service chi nhan duoc 1 tin nhan he thong dang
        // CHU ("X da mo cuoc hop") - KHONG kem meetingId, nen ca nhom nhin
        // thay tin do ma khong co cach nao biet cuoc hop nao ma vao. Endpoint
        // nay de phong chat tu tra ve cuoc hop dang mo cua chinh no.
        // Chi thanh vien hoi thoai duoc hoi (fail-closed neu khong hoi duoc
        // Chat Service).
        group.MapGet("/active", async (
            long conversationId, System.Security.Claims.ClaimsPrincipal principal,
            MediaDbContext db, ChatServiceClient chat, LiveKitService liveKit) =>
        {
            var callerId = principal.GetUserId()!.Value;
            var membership = await chat.GetMembershipAsync(conversationId, callerId);
            if (membership is null || !membership.IsMember)
                return Results.Json(new ErrorResponse("forbidden", "Ban khong thuoc hoi thoai nay"), statusCode: 403);

            var meeting = await db.Meetings
                .Where(m => m.ConversationId == conversationId && m.Status == MeetingStatus.Active)
                .OrderByDescending(m => m.Id)
                .FirstOrDefaultAsync();

            if (meeting is null)
                return Results.NoContent();

            // Tu chua lanh: neu phong ben LiveKit khong con (LiveKit tu don
            // phong rong sau EmptyTimeout) thi cuoc hop THAT SU da tan, du
            // DB van ghi "active" - truong hop moi nguoi dong tab chu khong
            // bam "Roi phong". Neu khong don o day, phong chat se hien banner
            // "Dang co cuoc hop" VINH VIEN cho mot cuoc hop khong con ai.
            if (!await liveKit.RoomExistsAsync(meeting.Id))
            {
                meeting.Status = MeetingStatus.Ended;
                meeting.EndedAt = DateTimeOffset.UtcNow;
                await db.MeetingParticipants
                    .Where(p => p.MeetingId == meeting.Id && p.LeftAt == null)
                    .ExecuteUpdateAsync(s => s.SetProperty(p => p.LeftAt, DateTimeOffset.UtcNow));
                await db.SaveChangesAsync();
                return Results.NoContent();
            }

            return Results.Ok(MeetingResponse.FromEntity(meeting));
        });

        // Vao thang cuoc hop cua chinh nhom minh - khong qua invite token.
        // Tu thiet ke, di kem GET /meetings/active o tren: luong invite hien
        // co (InvitesEndpoints.cs) sinh ra de moi NGUOI NGOAI, khong hop voi
        // UC-31 "mo hop trong nhom chat" (khong ai di tao link moi cho tung
        // thanh vien trong chinh nhom cua minh, va link invite thi luon phai
        // cho host duyet). Chi ap dung cho meeting co ConversationId.
        group.MapPost("/{meetingId:long}/join", async (
            long meetingId, JoinMeetingRequest? req, System.Security.Claims.ClaimsPrincipal principal,
            MediaDbContext db, ChatServiceClient chat, LiveKitService liveKit, IdentityClient identity) =>
        {
            var meeting = await db.Meetings.Include(m => m.Participants).FirstOrDefaultAsync(m => m.Id == meetingId);
            if (meeting is null || meeting.Status != MeetingStatus.Active)
                return Results.NotFound();

            var callerId = principal.GetUserId()!.Value;
            var existing = meeting.Participants.FirstOrDefault(p => p.UserId == callerId && p.LeftAt == null);

            // Host luon vao lai duoc phong cua chinh minh (ke ca cuoc hop
            // doc lap khong gan hoi thoai) - can thiet de host tai lai trang
            // van lay duoc token LiveKit moi, vi token chi duoc phat 1 lan
            // luc tao/duyet chu khong luu lai o dau.
            //
            // Nguoi DA o trong phong cung vay: ho da duoc nhan vao roi (vd
            // khach vao bang link, duoc host duyet o phong cho), tai lai
            // trang khong duoc coi la mat quyen. Thieu nhanh nay thi khach
            // moi F5 mot cai la ket "Khong lay duoc quyen vao phong hop" vi
            // token duyet nam trong Redis va chi doc duoc DUNG 1 LAN.
            if (existing is null && meeting.HostId != callerId)
            {
                if (meeting.ConversationId is null)
                    return Results.Json(
                        new ErrorResponse("invite_required", "Cuoc hop nay khong gan voi hoi thoai nao, phai vao bang link moi"),
                        statusCode: 403);

                var membership = await chat.GetMembershipAsync(meeting.ConversationId.Value, callerId);
                if (membership is null || !membership.IsMember)
                    return Results.Json(new ErrorResponse("forbidden", "Ban khong thuoc hoi thoai cua cuoc hop nay"), statusCode: 403);
            }

            var nickname = req?.Nickname ?? principal.GetNickname();

            if (existing is null)
            {
                var activeCount = meeting.Participants.Count(p => p.LeftAt == null);
                if (activeCount >= meeting.MaxParticipants)
                    return Results.Json(new ErrorResponse("room_full", "Phong da dat gioi han so nguoi"), statusCode: 409);

                db.MeetingParticipants.Add(new MeetingParticipant
                {
                    MeetingId = meeting.Id,
                    UserId = callerId,
                    Role = meeting.HostId == callerId ? ParticipantRole.Host : ParticipantRole.Participant,
                    JoinedAt = DateTimeOffset.UtcNow,
                });
                await db.SaveChangesAsync();
            }

            var email = (await identity.ResolveUserDetailAsync(callerId))?.Email;
            var token = liveKit.GenerateAccessToken(meeting.Id, callerId, nickname, email, TimeSpan.FromHours(6));
            return Results.Ok(new JoinResultResponse("approved", token, liveKit.ClientUrl, meeting.Id));
        });

        // Roi phong (tu minh) - thieu sot phat hien khi build Frontend F5:
        // truoc do CHI co kick moi set left_at, nguoi tu dong tab se mai mai
        // duoc dem la "dang o trong phong", khien trigger
        // trg_close_meeting_if_empty khong bao gio chay va so nguoi hien thi
        // sai. Idempotent: goi lai khi da roi van tra 204.
        group.MapPost("/{meetingId:long}/leave", async (
            long meetingId, System.Security.Claims.ClaimsPrincipal principal, MediaDbContext db) =>
        {
            var callerId = principal.GetUserId()!.Value;
            var participant = await db.MeetingParticipants
                .FirstOrDefaultAsync(p => p.MeetingId == meetingId && p.UserId == callerId && p.LeftAt == null);
            if (participant is null)
                return Results.NoContent();

            participant.LeftAt = DateTimeOffset.UtcNow;
            await db.SaveChangesAsync(); // trigger trg_close_meeting_if_empty tu dong dong phong neu day la nguoi cuoi
            return Results.NoContent();
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
