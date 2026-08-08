using System.Security.Claims;
using ChatService.Api.Data;
using ChatService.Api.Models;
using ChatService.Api.Services;
using Microsoft.EntityFrameworkCore;

namespace ChatService.Api.Endpoints;

public static class FileEndpoints
{
    public static void MapFileEndpoints(this WebApplication app)
    {
        // POST /files/upload-url
        app.MapPost("/files/upload-url", async (UploadUrlRequest req, ClaimsPrincipal principal, ChatDbContext db, MinioStorageService storage, WorkspaceClient workspaceClient) =>
        {
            var userId = GetUserId(principal)!.Value;
            var conversation = await db.Conversations.FindAsync(req.ConversationId);
            if (conversation is null)
                return Results.BadRequest(new ErrorResponse("invalid_conversation", "conversationId khong hop le"));
            if (!await ConversationEndpoints.IsMemberAsync(conversation, userId, workspaceClient))
                return Results.Json(new ErrorResponse("forbidden", "Ban khong thuoc cuoc tro chuyen nay"), statusCode: 403);

            var fileType = FileAttachment.TypeFromString(req.FileType);
            if (conversation.Type == ConversationType.P2P && fileType == FileType.File)
                return Results.Json(new ErrorResponse("file_not_supported_in_p2p", "Chat 1-1 khong ho tro gui File"), statusCode: 422);

            // UC-29: kiem tra quota + trang thai khoa cua nhom TRUOC khi cho
            // upload - vi trigger DB cong storage_used_bytes ngay khi insert
            // vao bang files (khong doi toi luc gan vao message), phai chan
            // o day, khong phai o buoc gui message.
            GroupChatSettings? settings = null;
            if (conversation.Type == ConversationType.Group)
            {
                settings = await db.GroupChatSettings.FindAsync(req.ConversationId);
                if (settings is not null)
                {
                    if (settings.IsLocked)
                        return Results.Json(new ErrorResponse("storage_locked", "Nhom da bi khoa vi vuot han muc luu tru, can Truong nhom nap them/mo khoa"), statusCode: 507);
                    if (settings.StorageUsedBytes + req.SizeBytes > settings.StorageQuotaBytes)
                        return Results.Json(new ErrorResponse("storage_quota_exceeded", "Vuot qua han muc luu tru cua nhom"), statusCode: 507);
                }
            }

            var file = new FileAttachment
            {
                ConversationId = req.ConversationId,
                UploadedBy = userId,
                ObjectKey = $"{req.ConversationId}/{Guid.NewGuid():N}",
                FileType = fileType,
                SizeBytes = req.SizeBytes,
                UploadedAt = DateTimeOffset.UtcNow,
            };
            db.Files.Add(file);
            await db.SaveChangesAsync(); // trigger DB tu cong storage_used_bytes neu la group

            // Vua vuot qua han muc SAU khi cong (khong chan upload nay - da
            // cho phep - nhung khoa cho lan sau, dung theo UC-29 "khoa khi
            // vuot han muc").
            if (settings is not null && settings.StorageUsedBytes + req.SizeBytes >= settings.StorageQuotaBytes)
            {
                settings.IsLocked = true;
                settings.StorageExpiresAt = DateTimeOffset.UtcNow.AddDays(3); // xem StorageWarningService cho chuoi canh bao
                await db.SaveChangesAsync();
            }

            var uploadUrl = storage.GeneratePresignedUploadUrl(file.ObjectKey);
            return Results.Ok(new UploadUrlResponse(file.Id, uploadUrl, 300));
        }).RequireAuthorization();

        var conv = app.MapGroup("/conversations").RequireAuthorization();

        conv.MapGet("/{conversationId:long}/files", async (long conversationId, ClaimsPrincipal principal, ChatDbContext db, WorkspaceClient workspaceClient) =>
        {
            var userId = GetUserId(principal)!.Value;
            var conversation = await db.Conversations.FindAsync(conversationId);
            if (conversation is null)
                return Results.NotFound();
            if (!await ConversationEndpoints.IsMemberAsync(conversation, userId, workspaceClient))
                return Results.Json(new ErrorResponse("forbidden", "Ban khong thuoc cuoc tro chuyen nay"), statusCode: 403);

            var files = await db.Files.Where(f => f.ConversationId == conversationId).ToListAsync();
            return Results.Ok(files.Select(FileMetaResponse.FromEntity));
        });

        // UC-28: xoa file de giai phong quota. Group: chi Truong nhom. P2P:
        // nguoi upload tu xoa (gia dinh rieng, tuong tu Messages).
        conv.MapDelete("/{conversationId:long}/files/{fileId:long}", async (long conversationId, long fileId, ClaimsPrincipal principal, ChatDbContext db, WorkspaceClient workspaceClient) =>
        {
            var userId = GetUserId(principal)!.Value;
            var conversation = await db.Conversations.FindAsync(conversationId);
            if (conversation is null)
                return Results.NotFound();

            var file = await db.Files.SingleOrDefaultAsync(f => f.Id == fileId && f.ConversationId == conversationId);
            if (file is null)
                return Results.NotFound();

            if (conversation.Type == ConversationType.Group)
            {
                if (!await ConversationEndpoints.IsLeaderAsync(conversation, userId, workspaceClient))
                    return Results.Json(new ErrorResponse("forbidden", "Chi Truong nhom duoc xoa file"), statusCode: 403);
            }
            else if (file.UploadedBy != userId)
            {
                return Results.Json(new ErrorResponse("forbidden", "Chi nguoi upload duoc xoa file nay"), statusCode: 403);
            }

            db.Files.Remove(file); // trigger DB tu tru storage_used_bytes neu la group
            await db.SaveChangesAsync();
            return Results.NoContent();
        });
    }

    private static long? GetUserId(ClaimsPrincipal principal)
    {
        var sub = principal.FindFirstValue("sub");
        return sub is not null && long.TryParse(sub, out var id) ? id : null;
    }
}
