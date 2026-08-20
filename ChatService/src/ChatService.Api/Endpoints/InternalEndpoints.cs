using ChatService.Api.Data;
using ChatService.Api.Hubs;
using ChatService.Api.Models;
using ChatService.Api.Services;
using Microsoft.AspNetCore.SignalR;
using Microsoft.EntityFrameworkCore;

namespace ChatService.Api.Endpoints;

public record CreateGroupInternalRequest(long WorkspaceId);
public record SystemMessageRequest(string Content);
public record P2PInternalRequest(long UserAId, long UserBId);
public record ConversationMembershipResponse(bool IsMember, bool IsLeader);

// KHONG di qua API Gateway public - dung boi WorkSpace Service (xem
// WorkSpaceService/Services/ChatServiceClient.cs).
public static class InternalEndpoints
{
    public static void MapInternalEndpoints(this WebApplication app)
    {
        // Goi ngay sau khi WorkSpace Service tao workspace moi - dam bao 1
        // group conversation luon di kem 1 workspace. Idempotent: goi lai
        // nhieu lan voi cung workspaceId khong tao trung (rang buoc UNIQUE
        // idx_conversations_one_per_workspace da co san o DB).
        app.MapPost("/internal/conversations/group", async (CreateGroupInternalRequest req, ChatDbContext db) =>
        {
            var existing = await db.Conversations
                .SingleOrDefaultAsync(c => c.Type == ConversationType.Group && c.WorkspaceId == req.WorkspaceId);
            if (existing is not null)
                return Results.Ok(ConversationResponse.FromEntity(existing));

            var conversation = new Conversation
            {
                Type = ConversationType.Group,
                WorkspaceId = req.WorkspaceId,
                CreatedAt = DateTimeOffset.UtcNow,
            };
            db.Conversations.Add(conversation);
            await db.SaveChangesAsync();

            db.GroupChatSettings.Add(new GroupChatSettings
            {
                ConversationId = conversation.Id,
                Plan = StoragePlan.Free,
                StorageQuotaBytes = 2_147_483_648,
                UpdatedAt = DateTimeOffset.UtcNow,
            });
            await db.SaveChangesAsync();

            return Results.Created($"/conversations/{conversation.Id}", ConversationResponse.FromEntity(conversation));
        });

        app.MapDelete("/internal/conversations/by-workspace/{workspaceId:long}", async (long workspaceId, ChatDbContext db) =>
        {
            var conversation = await db.Conversations
                .SingleOrDefaultAsync(c => c.Type == ConversationType.Group && c.WorkspaceId == workspaceId);
            if (conversation is null)
                return Results.NoContent(); // khong co gi de don, khong phai loi

            // Xoa conversation se cascade xoa messages/files/group_chat_settings/
            // muted_members lien quan qua FK ON DELETE CASCADE da khai bao
            // trong chat-db-init.sql.
            db.Conversations.Remove(conversation);
            await db.SaveChangesAsync();
            return Results.NoContent();
        });

        // Lay (hoac tao) hoi thoai 1-1 giua hai nguoi - dung boi Media Service
        // khi moi ban be vao cuoc hop (UC-32): loi moi duoc gui bang chinh
        // tin nhan he thong trong khung chat rieng cua hai nguoi, thay vi
        // mot hang doi thong bao khong ai doc. Logic trung voi
        // POST /conversations/p2p ban public, chi khac la khong lay nguoi
        // goi tu JWT ma nhan ca hai id.
        app.MapPost("/internal/conversations/p2p", async (P2PInternalRequest req, ChatDbContext db) =>
        {
            if (req.UserAId == req.UserBId)
                return Results.BadRequest(new ErrorResponse("invalid_request", "Hai id trung nhau"));

            var (a, b) = req.UserAId < req.UserBId ? (req.UserAId, req.UserBId) : (req.UserBId, req.UserAId);
            var existing = await db.Conversations.SingleOrDefaultAsync(c =>
                c.Type == ConversationType.P2P &&
                ((c.ParticipantAId == a && c.ParticipantBId == b) || (c.ParticipantAId == b && c.ParticipantBId == a)));

            if (existing is not null)
                return Results.Ok(ConversationResponse.FromEntity(existing));

            var conversation = new Conversation
            {
                Type = ConversationType.P2P,
                ParticipantAId = a,
                ParticipantBId = b,
                CreatedAt = DateTimeOffset.UtcNow,
            };
            db.Conversations.Add(conversation);
            await db.SaveChangesAsync();
            return Results.Ok(ConversationResponse.FromEntity(conversation));
        });

        // Tin nhan he thong (vd: "X da mo cuoc hop") - dung boi Media Service
        // (Phase 5) khi mo cuoc hop voi mode=in_chat. SenderId = null,
        // Type = System - da co san trong Message model (Models/Message.cs)
        // tu truoc, chua tung dung toi cho den bay gio.
        app.MapPost("/internal/conversations/{conversationId:long}/system-message", async (
            long conversationId, SystemMessageRequest req, ChatDbContext db, IHubContext<ChatHub> hub) =>
        {
            var conversation = await db.Conversations.FindAsync(conversationId);
            if (conversation is null)
                return Results.NotFound();

            var message = new Message
            {
                ConversationId = conversationId,
                SenderId = null,
                Type = MessageType.System,
                Content = req.Content,
                CreatedAt = DateTimeOffset.UtcNow,
            };
            db.Messages.Add(message);
            await db.SaveChangesAsync();

            var response = MessageResponse.FromEntity(message);
            // Truoc day chi ghi vao CSDL roi thoi - ai dang mo phong chat
            // KHONG thay gi cho toi luc tai lai trang, nen thong bao "da mo
            // cuoc hop" gan nhu luon toi muon. Phat qua SignalR giong het
            // duong tin nhan thuong de no hien ngay.
            await hub.Clients.Group(ChatHub.GroupName(conversationId)).SendAsync("MessageReceived", response);

            return Results.Created($"/conversations/{conversationId}/messages/{message.Id}", response);
        });

        // Kiem tra tu cach thanh vien 1 hoi thoai - tu de xuat, thieu sot
        // phat hien khi build Frontend F5: Media Service mo cuoc hop voi
        // mode=in_chat thi CA NHOM phai vao duoc thang (khong ai di gui link
        // moi cho tung nguoi trong chinh nhom cua minh), nhung Media Service
        // khong co ban sao workspace_members nen khong tu kiem tra duoc.
        // Tra ve luon isLeader de Media Service biet ai co quyen "chu phong"
        // ma khong phai goi them WorkSpace Service.
        app.MapGet("/internal/conversations/{conversationId:long}/members/{userId:long}", async (
            long conversationId, long userId, ChatDbContext db, WorkspaceClient workspaceClient) =>
        {
            var conversation = await db.Conversations.FindAsync(conversationId);
            if (conversation is null)
                return Results.NotFound();

            var isMember = await ConversationEndpoints.IsMemberAsync(conversation, userId, workspaceClient);
            var isLeader = isMember && await ConversationEndpoints.IsLeaderAsync(conversation, userId, workspaceClient);
            return Results.Ok(new ConversationMembershipResponse(isMember, isLeader));
        });

        // Ngat ket noi WebSocket realtime khi bi kick/tu roi nhom - tu de
        // xuat (tai lieu roadmap muc 6.4: "Trigger ngat WebSocket phia Chat
        // Service khi kick/roi nhom"). Goi boi WorkSpace Service ngay sau
        // khi xoa thanh vien (xem WorkspaceEndpoints.cs, ca 2 nhanh kick va
        // tu roi). Chi go khoi group cua CONVERSATION GROUP tuong ung -
        // khong dong toan bo ket noi WebSocket cua user (ho van con o cac
        // conversation/workspace khac).
        app.MapPost("/internal/conversations/by-workspace/{workspaceId:long}/members/{userId:long}/disconnect", async (
            long workspaceId, long userId, ChatDbContext db, IHubContext<ChatHub> hub, PresenceTracker presence) =>
        {
            var conversation = await db.Conversations
                .SingleOrDefaultAsync(c => c.Type == ConversationType.Group && c.WorkspaceId == workspaceId);
            if (conversation is null)
                return Results.NoContent();

            var connectionIds = presence.GetConnections(userId);
            foreach (var connectionId in connectionIds)
                await hub.Groups.RemoveFromGroupAsync(connectionId, ChatHub.GroupName(conversation.Id));

            if (connectionIds.Count > 0)
                await hub.Clients.Clients(connectionIds).SendAsync("KickedFromConversation", conversation.Id);

            return Results.NoContent();
        });

        // ============ Khieu nai - dung boi Admin Service (Phase 4) ============
        // Cung ComplaintStore/key Redis voi /complaints public (xem
        // ComplaintsEndpoints.cs) - day chi la "cua sau" noi bo cho Admin doc/
        // tra loi, khong qua API Gateway public.
        app.MapGet("/internal/complaints", async (ComplaintStore store) =>
            Results.Ok(await store.ListActiveAsync()));

        app.MapGet("/internal/complaints/{userId:long}", async (long userId, ComplaintStore store) =>
        {
            var messages = await store.GetMessagesAsync(userId);
            return messages.Count == 0 ? Results.NotFound() : Results.Ok(messages);
        });

        app.MapPost("/internal/complaints/{userId:long}/reply", async (long userId, ComplaintReplyRequest req, ComplaintStore store) =>
        {
            if (string.IsNullOrWhiteSpace(req.Message))
                return Results.BadRequest(new ErrorResponse("invalid_request", "Noi dung phan hoi khong duoc trong"));

            // Neu chua co khieu nai nao (key da het TTL/chua ton tai), khong
            // tao moi tu phia Admin - Admin chi phan hoi trong hoi thoai da
            // co, dung nghia "reply".
            var existing = await store.GetMessagesAsync(userId);
            if (existing.Count == 0)
                return Results.NotFound();

            var message = new ComplaintMessageResponse("admin", req.Message, DateTimeOffset.UtcNow);
            await store.AppendMessageAsync(userId, message);
            return Results.Created($"/internal/complaints/{userId}", message);
        });

        // ============ Yeu cau nap dung luong - dung boi Admin Service ============
        // Truong nhom gui yeu cau qua API public (xem ConversationEndpoints.cs
        // POST .../storage/topup-requests), Admin duyet/tu choi qua day - tu
        // thiet ke lai theo yeu cau nguoi dung du an, thay cho co che tu-nap
        // truc tiep cu (khong qua duyet).
        app.MapGet("/internal/storage-topup-requests", async (string? status, ChatDbContext db) =>
        {
            var query = db.StorageTopupRequests.AsQueryable();
            if (status is not null && Enum.TryParse<TopupRequestStatus>(status, true, out var parsed))
                query = query.Where(r => r.Status == parsed);

            var requests = await query.OrderBy(r => r.CreatedAt).ToListAsync();
            return Results.Ok(requests.Select(r => new TopupRequestResponse(
                r.Id, r.ConversationId, r.RequestedBy, r.Amount,
                r.Status == TopupRequestStatus.Pending ? "pending" : r.Status == TopupRequestStatus.Approved ? "approved" : "rejected",
                r.CreatedAt)));
        });

        app.MapPost("/internal/storage-topup-requests/{requestId:long}/approve", async (long requestId, long adminUserId, ChatDbContext db) =>
        {
            var request = await db.StorageTopupRequests.FindAsync(requestId);
            if (request is null || request.Status != TopupRequestStatus.Pending)
                return Results.NotFound();

            var settings = await db.GroupChatSettings.FindAsync(request.ConversationId);
            if (settings is null)
                return Results.NotFound();

            // Quy doi tien -> bytes: BANG GIA CHUA duoc chot trong tai lieu goc
            // (xem UC-29, ngoai pham vi spec API) - tam quy uoc 1 don vi tien =
            // 1GB de co logic chay duoc, thay bang bang gia that sau.
            const long bytesPerUnit = 1_073_741_824L;
            settings.Plan = StoragePlan.Paid;
            settings.StorageQuotaBytes += (long)(request.Amount * bytesPerUnit);
            settings.IsLocked = false;
            settings.StorageExpiresAt = null;
            settings.LastWarningStage = null;
            settings.UpdatedAt = DateTimeOffset.UtcNow;

            request.Status = TopupRequestStatus.Approved;
            request.ResolvedAt = DateTimeOffset.UtcNow;
            request.ResolvedBy = adminUserId;
            await db.SaveChangesAsync();

            return Results.Ok(StorageInfoResponse.FromEntity(settings));
        });

        app.MapPost("/internal/storage-topup-requests/{requestId:long}/reject", async (long requestId, long adminUserId, ChatDbContext db) =>
        {
            var request = await db.StorageTopupRequests.FindAsync(requestId);
            if (request is null || request.Status != TopupRequestStatus.Pending)
                return Results.NotFound();

            request.Status = TopupRequestStatus.Rejected;
            request.ResolvedAt = DateTimeOffset.UtcNow;
            request.ResolvedBy = adminUserId;
            await db.SaveChangesAsync();

            return Results.NoContent();
        });
    }
}
