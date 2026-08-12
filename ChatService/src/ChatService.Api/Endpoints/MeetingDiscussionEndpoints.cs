using System.Security.Claims;
using ChatService.Api.Data;
using ChatService.Api.Hubs;
using ChatService.Api.Models;
using ChatService.Api.Services;
using Microsoft.AspNetCore.SignalR;
using Microsoft.EntityFrameworkCore;

namespace ChatService.Api.Endpoints;

// Luong THAO LUAN rieng cua tung cuoc hop - tu thiet ke theo yeu cau nguoi
// dung du an, KHONG co trong tai lieu goc (muc 7 khong he co chat trong
// cuoc hop, xem 7.1/7.2/7.3 va UC-31..UC-37).
//
// 3 quyet dinh thiet ke chinh:
//
// 1. Nam trong CHINH bang messages cua hoi thoai nhom, phan biet bang cot
//    meeting_id, thay vi tao mot conversation rieng. Ly do: file dinh kem
//    tu dong tinh vao han muc luu tru cua nhom (trigger DB cong
//    storage_used_bytes theo conversation_id) - dung yeu cau "file cung tinh
//    vao 2GB tong" ma khong phai viet them logic ke toan nao.
//
// 2. KHONG ma hoa (is_encrypted = false). Khach vang lai vao hop bang link
//    khong co cap khoa X25519 nao nen khong the dung E2EE cua chat nhom.
//    Day la danh doi da biet va duoc chap nhan - giong Microsoft Teams,
//    chat trong cuoc hop cung khong ma hoa dau cuoi.
//
// 3. Quyen truy cap hai nhanh (xem CanAccessAsync).
public static class MeetingDiscussionEndpoints
{
    // Thanh vien nhom: vao duoc BAT KE cuoc hop con dien ra hay da ket thuc
    // (theo lua chon cua nguoi dung du an: "giu lai, van nhan tiep duoc").
    //
    // Khach vang lai: chi khi DANG thuc su o trong cuoc hop VA cuoc hop con
    // dien ra. Roi phong / het hop la mat quyen - giong Teams, nguoi an danh
    // khong giu duoc lich su sau khi roi.
    //
    // Voi thanh vien nhom KHONG goi Media Service: (a) do 1 vong goi mang
    // tren moi request, (b) khong de mot su co cua Media Service lam chet
    // luon thao luan cua thanh vien that. An toan vi MOI truy van deu bi
    // rang buoc conversation_id = hoi thoai dang mo, nen dua meetingId cua
    // hoi thoai khac vao cung khong doc duoc gi cua hoi thoai do.
    internal static async Task<bool> CanAccessAsync(
        Conversation conversation, long meetingId, long userId,
        WorkspaceClient workspaceClient, MediaServiceClient mediaClient)
    {
        if (await ConversationEndpoints.IsMemberAsync(conversation, userId, workspaceClient))
            return true;

        // Fail-CLOSED: khong hoi duoc Media Service -> tu choi.
        var membership = await mediaClient.GetMembershipAsync(meetingId, userId);
        return membership is { IsParticipant: true, Status: "active" }
            && membership.ConversationId == conversation.Id;
    }

    public static void MapMeetingDiscussionEndpoints(this WebApplication app)
    {
        // Liet ke cac cuoc hop DA CO thao luan trong hoi thoai nay, de phong
        // chat hien link "xem lai thao luan cua cuoc hop truoc".
        //
        // Lay tu chinh Chat DB (distinct meeting_id trong messages) chu KHONG
        // hoi Media Service: cai man hinh can la "nhung thao luan co noi dung
        // de xem", khong phai "moi cuoc hop tung mo" - cuoc hop mo ra roi
        // khong ai nhan gi thi khong co gi de xem lai.
        app.MapGet("/conversations/{conversationId:long}/meetings", async (
            long conversationId, ClaimsPrincipal principal, ChatDbContext db, WorkspaceClient workspaceClient) =>
        {
            var userId = GetUserId(principal)!.Value;
            var conversation = await db.Conversations.FindAsync(conversationId);
            if (conversation is null)
                return Results.NotFound();
            // Chi thanh vien nhom - khach vang lai khong duoc xem danh sach
            // cac cuoc hop cu cua nhom.
            if (!await ConversationEndpoints.IsMemberAsync(conversation, userId, workspaceClient))
                return Results.Json(new ErrorResponse("forbidden", "Ban khong thuoc cuoc tro chuyen nay"), statusCode: 403);

            // Chieu sang kieu AN DANH truoc roi moi map sang record trong bo
            // nho: EF Core khong dich duoc GroupBy(...).Select(...) khi ben
            // trong goi thang constructor cua record (loi that gap khi test:
            // "The LINQ expression ... could not be translated").
            var raw = await db.Messages
                .Where(m => m.ConversationId == conversationId && m.MeetingId != null)
                .GroupBy(m => m.MeetingId)
                .Select(g => new { MeetingId = g.Key, Count = g.Count(), Last = g.Max(m => m.CreatedAt) })
                .ToListAsync();

            var items = raw
                .OrderByDescending(x => x.Last)
                .Select(x => new MeetingDiscussionSummary(x.MeetingId!.Value, x.Count, x.Last))
                .ToList();

            return Results.Ok(items);
        }).RequireAuthorization();

        var group = app.MapGroup("/conversations/{conversationId:long}/meetings/{meetingId:long}")
            .RequireAuthorization();

        group.MapGet("/messages", async (
            long conversationId, long meetingId, ClaimsPrincipal principal, ChatDbContext db,
            WorkspaceClient workspaceClient, MediaServiceClient mediaClient, IdentityClient identity,
            DateTimeOffset? before, int? limit) =>
        {
            var userId = GetUserId(principal)!.Value;
            var conversation = await db.Conversations.FindAsync(conversationId);
            if (conversation is null)
                return Results.NotFound();
            if (!await CanAccessAsync(conversation, meetingId, userId, workspaceClient, mediaClient))
                return Results.Json(new ErrorResponse("forbidden", "Ban khong co quyen xem thao luan cua cuoc hop nay"), statusCode: 403);

            var take = Math.Clamp(limit ?? 50, 1, 200);

            // KHONG dung ChatCacheService: cache duoc danh chi muc theo
            // conversation, tin thao luan chui vao do se lan sang luong chat
            // chinh. Thao luan doc thang tu Postgres.
            var query = db.Messages.Where(m => m.ConversationId == conversationId && m.MeetingId == meetingId);
            if (before is not null)
                query = query.Where(m => m.CreatedAt < before);

            var messages = await query.OrderByDescending(m => m.CreatedAt).Take(take).ToListAsync();
            var messageIds = messages.Select(m => m.Id).ToList();
            var fileIds = await db.Files
                .Where(f => f.ConversationId == conversationId && f.MessageId != null && messageIds.Contains(f.MessageId!.Value))
                .ToDictionaryAsync(f => f.MessageId!.Value, f => f.Id);

            // Ten nguoi gui phai hoi Identity Service (khong dung danh sach
            // thanh vien workspace nhu chat nhom) vi khach vang lai khong
            // thuoc workspace nao - tra ve theo cach cu se thanh "nguoi trong
            // nhom" cho tat ca khach.
            var senders = await identity.ResolveUsersAsync(messages.Where(m => m.SenderId is not null).Select(m => m.SenderId!.Value));

            var result = messages.Select(m => MessageResponse.FromEntity(
                m,
                senderDisplayName: m.SenderId is not null && senders.TryGetValue(m.SenderId.Value, out var u) ? u.Nickname : null,
                fileId: fileIds.TryGetValue(m.Id, out var fid) ? fid : null));

            return Results.Ok(result);
        });

        group.MapPost("/messages", async (
            long conversationId, long meetingId, CreateMessageRequest req, ClaimsPrincipal principal,
            ChatDbContext db, WorkspaceClient workspaceClient, MediaServiceClient mediaClient,
            IdentityClient identity, IHubContext<ChatHub> hub, KafkaProducerService kafka) =>
        {
            var userId = GetUserId(principal)!.Value;
            var conversation = await db.Conversations.FindAsync(conversationId);
            if (conversation is null)
                return Results.NotFound();
            if (!await CanAccessAsync(conversation, meetingId, userId, workspaceClient, mediaClient))
                return Results.Json(new ErrorResponse("forbidden", "Ban khong co quyen gui trong thao luan cua cuoc hop nay"), statusCode: 403);

            var type = Message.TypeFromString(req.Type);
            if (type == MessageType.System || type == MessageType.Vote)
                return Results.BadRequest(new ErrorResponse("invalid_request", "Loai tin nhan khong hop le cho thao luan"));

            // KHAC han luong chat chinh: Text o day KHONG ma hoa (khong doi
            // contentNonce/recipientKeys). Xem ghi chu dau file.
            if (type == MessageType.Text && string.IsNullOrWhiteSpace(req.Content))
                return Results.BadRequest(new ErrorResponse("invalid_request", "Noi dung tin nhan khong duoc trong"));

            // Cam chat trong nhom ap dung luon cho thao luan - neu khong,
            // nguoi bi mute chi can mo thao luan la noi tiep duoc.
            if (conversation.Type == ConversationType.Group)
            {
                var muted = await db.MutedMembers.AnyAsync(m => m.ConversationId == conversationId && m.UserId == userId);
                if (muted)
                    return Results.Json(new ErrorResponse("muted", "Ban dang bi cam chat trong nhom nay"), statusCode: 403);
            }

            FileAttachment? file = null;
            if (req.FileId is not null)
            {
                file = await db.Files.FindAsync(req.FileId.Value);
                if (file is null || file.ConversationId != conversationId)
                    return Results.BadRequest(new ErrorResponse("invalid_file", "fileId khong hop le hoac khong thuoc conversation nay"));
            }

            var message = new Message
            {
                ConversationId = conversationId,
                MeetingId = meetingId,
                SenderId = userId,
                Type = type,
                Content = req.Content,
                IsEncrypted = false,
                ContentNonce = null,
                CreatedAt = DateTimeOffset.UtcNow,
            };
            db.Messages.Add(message);
            await db.SaveChangesAsync();

            if (file is not null)
            {
                file.MessageId = message.Id;
                await db.SaveChangesAsync();
            }

            // CO Y khong dat conversation.LastMessageAt: thao luan la luong
            // phu, khong duoc day hoi thoai len dau danh sach chat nhu tin
            // nhan that.

            var senders = await identity.ResolveUsersAsync([userId]);
            var response = MessageResponse.FromEntity(
                message,
                senderDisplayName: senders.TryGetValue(userId, out var u) ? u.Nickname : null,
                fileId: file?.Id);

            // Broadcast vao group RIENG cua cuoc hop (khong phai group cua
            // conversation) - khach vang lai khong duoc phep nghe len luong
            // chat chinh cua nhom.
            await hub.Clients.Group(ChatHub.MeetingGroupName(meetingId)).SendAsync("MeetingMessageReceived", response);

            // Thao luan KHONG ma hoa nen noi dung that su gui duoc sang
            // SpamTrackingService phan tich (khac chat nhom E2EE chi gui
            // duoc null).
            await kafka.PublishChatLogAsync(conversationId, message.Id, userId, req.Type, req.Content);

            return Results.Created(
                $"/conversations/{conversationId}/meetings/{meetingId}/messages/{message.Id}", response);
        });
    }

    private static long? GetUserId(ClaimsPrincipal principal)
    {
        var sub = principal.FindFirstValue("sub");
        return sub is not null && long.TryParse(sub, out var id) ? id : null;
    }
}
