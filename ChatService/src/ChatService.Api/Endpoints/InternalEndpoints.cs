using ChatService.Api.Data;
using ChatService.Api.Models;
using ChatService.Api.Services;
using Microsoft.EntityFrameworkCore;

namespace ChatService.Api.Endpoints;

public record CreateGroupInternalRequest(long WorkspaceId);
public record SystemMessageRequest(string Content);

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

        // Tin nhan he thong (vd: "X da mo cuoc hop") - dung boi Media Service
        // (Phase 5) khi mo cuoc hop voi mode=in_chat. SenderId = null,
        // Type = System - da co san trong Message model (Models/Message.cs)
        // tu truoc, chua tung dung toi cho den bay gio.
        app.MapPost("/internal/conversations/{conversationId:long}/system-message", async (long conversationId, SystemMessageRequest req, ChatDbContext db) =>
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

            return Results.Created($"/conversations/{conversationId}/messages/{message.Id}", MessageResponse.FromEntity(message));
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
    }
}
