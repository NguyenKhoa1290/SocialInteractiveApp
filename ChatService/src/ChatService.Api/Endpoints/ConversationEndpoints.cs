using System.Security.Claims;
using ChatService.Api.Data;
using ChatService.Api.Models;
using ChatService.Api.Services;
using Microsoft.EntityFrameworkCore;

namespace ChatService.Api.Endpoints;

public static class ConversationEndpoints
{
    private const long VideoMaxBytes = 50L * 1024 * 1024;
    private const long VoiceMaxBytes = 25L * 1024 * 1024;

    public static void MapConversationEndpoints(this WebApplication app)
    {
        var conv = app.MapGroup("/conversations").RequireAuthorization();

        // UC-25/26: Tao hoac lay conversation P2P - idempotent theo cap user
        conv.MapPost("/p2p", async (CreateP2PRequest req, ClaimsPrincipal principal, ChatDbContext db) =>
        {
            var userId = GetUserId(principal)!.Value;
            if (req.OtherUserId == userId)
                return Results.BadRequest(new ErrorResponse("invalid_request", "Khong the tao cuoc tro chuyen voi chinh minh"));

            var (a, b) = userId < req.OtherUserId ? (userId, req.OtherUserId) : (req.OtherUserId, userId);
            var existing = await db.Conversations.SingleOrDefaultAsync(c =>
                c.Type == ConversationType.P2P &&
                ((c.ParticipantAId == a && c.ParticipantBId == b) || (c.ParticipantAId == b && c.ParticipantBId == a)));

            if (existing is not null)
                return Results.Ok(ConversationResponse.FromEntity(existing));

            var conversation = new Conversation
            {
                Type = ConversationType.P2P,
                ParticipantAId = userId,
                ParticipantBId = req.OtherUserId,
                CreatedAt = DateTimeOffset.UtcNow,
            };
            db.Conversations.Add(conversation);
            await db.SaveChangesAsync();

            return Results.Ok(ConversationResponse.FromEntity(conversation));
        });

        conv.MapGet("/{conversationId:long}", async (long conversationId, ClaimsPrincipal principal, ChatDbContext db, WorkspaceClient workspaceClient) =>
        {
            var userId = GetUserId(principal)!.Value;
            var conversation = await db.Conversations.FindAsync(conversationId);
            if (conversation is null)
                return Results.NotFound();

            if (!await IsMemberAsync(conversation, userId, workspaceClient))
                return Results.Json(new ErrorResponse("forbidden", "Ban khong thuoc cuoc tro chuyen nay"), statusCode: 403);

            return Results.Ok(ConversationResponse.FromEntity(conversation));
        });

        // UC-25/27: Lay lich su tin nhan
        // GHI CHU: chua cai dat logic route Redis (<10.000 tin & <10 ngay) / Postgres
        // theo Search Chat Service (tai lieu roadmap muc 6.1) - hien luon doc thang
        // Postgres, se toi uu sau khi co consumer "Write Chat" dong bo Redis.
        conv.MapGet("/{conversationId:long}/messages", async (long conversationId, ClaimsPrincipal principal, ChatDbContext db, WorkspaceClient workspaceClient, DateTimeOffset? before, int? limit) =>
        {
            var userId = GetUserId(principal)!.Value;
            var conversation = await db.Conversations.FindAsync(conversationId);
            if (conversation is null)
                return Results.NotFound();
            if (!await IsMemberAsync(conversation, userId, workspaceClient))
                return Results.Json(new ErrorResponse("forbidden", "Ban khong thuoc cuoc tro chuyen nay"), statusCode: 403);

            var take = Math.Clamp(limit ?? 50, 1, 200);
            var query = db.Messages.Where(m => m.ConversationId == conversationId);
            if (before is not null)
                query = query.Where(m => m.CreatedAt < before);

            var messages = await query.OrderByDescending(m => m.CreatedAt).Take(take).ToListAsync();
            var fileIds = await db.Files.Where(f => f.ConversationId == conversationId && f.MessageId != null)
                .ToDictionaryAsync(f => f.MessageId!.Value, f => f.Id);

            // E2EE Group: moi user chi duoc thay khoa phien DA MA HOA CHO
            // CHINH MINH, khong thay khoa cua nguoi khac (moi nguoi 1 ban ma
            // hoa rieng, xem MessageRecipientKey.cs).
            Dictionary<long, string>? ownRecipientKeys = null;
            if (conversation.Type == ConversationType.Group)
            {
                var messageIds = messages.Where(m => m.IsEncrypted).Select(m => m.Id).ToList();
                ownRecipientKeys = await db.MessageRecipientKeys
                    .Where(k => messageIds.Contains(k.MessageId) && k.RecipientUserId == userId)
                    .ToDictionaryAsync(k => k.MessageId, k => k.EncryptedKey);
            }

            // senderDisplayName: tinh dong, "nguoi trong nhom" neu sender khong
            // con la thanh vien workspace (UC-22) - CHI ap dung cho group,
            // dung theo tai lieu roadmap muc 5.6/6.2 Ghi chu.
            Dictionary<long, Services.WorkspaceMemberInfo>? currentMembers = null;
            if (conversation.Type == ConversationType.Group && conversation.WorkspaceId is not null)
            {
                var members = await workspaceClient.GetMembersAsync(conversation.WorkspaceId.Value);
                currentMembers = members?.ToDictionary(m => m.UserId);
            }

            var result = messages.Select(m =>
            {
                string? displayName = null;
                if (conversation.Type == ConversationType.Group && m.SenderId is not null)
                {
                    displayName = currentMembers is not null && currentMembers.TryGetValue(m.SenderId.Value, out var info)
                        ? info.Nickname
                        : "người trong nhóm";
                }
                var fileId = fileIds.GetValueOrDefault(m.Id);
                var recipientKey = ownRecipientKeys?.GetValueOrDefault(m.Id);
                return MessageResponse.FromEntity(m, displayName, fileId == 0 ? null : fileId, recipientKey);
            });

            return Results.Ok(result);
        });

        // UC-25 (P2P) / UC-27 (Group): gui tin nhan
        conv.MapPost("/{conversationId:long}/messages", async (long conversationId, CreateMessageRequest req, ClaimsPrincipal principal, ChatDbContext db, KafkaProducerService kafka, WorkspaceClient workspaceClient) =>
        {
            var userId = GetUserId(principal)!.Value;
            var conversation = await db.Conversations.FindAsync(conversationId);
            if (conversation is null)
                return Results.NotFound();
            if (!await IsMemberAsync(conversation, userId, workspaceClient))
                return Results.Json(new ErrorResponse("forbidden", "Ban khong thuoc cuoc tro chuyen nay"), statusCode: 403);

            var type = Message.TypeFromString(req.Type);

            if (type == MessageType.File && conversation.Type == ConversationType.P2P)
                return Results.Json(new ErrorResponse("file_not_supported_in_p2p", "Chat 1-1 khong ho tro gui File"), statusCode: 422);

            // E2EE bat buoc cho tin nhan Text (tu de xuat) - server khong tu
            // ma hoa thay, chi kiem tra client da guI dung "hinh dang" du
            // lieu da ma hoa (ciphertext + nonce, kem khoa fan-out neu la
            // Group) truoc khi luu, KHONG the kiem tra ma hoa co dung hay
            // khong (server khong co khoa de verify).
            if (type == MessageType.Text)
            {
                if (string.IsNullOrWhiteSpace(req.Content) || string.IsNullOrWhiteSpace(req.ContentNonce))
                    return Results.BadRequest(new ErrorResponse("invalid_request", "Tin nhan Text bat buoc phai ma hoa (content + contentNonce)"));

                if (conversation.Type == ConversationType.Group && (req.RecipientKeys is null || req.RecipientKeys.Count == 0))
                    return Results.BadRequest(new ErrorResponse("invalid_request", "Tin nhan Text trong Group bat buoc kem recipientKeys (khoa phien ma hoa rieng cho tung thanh vien)"));
            }

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

                if (type == MessageType.Video && file.SizeBytes > VideoMaxBytes)
                    return Results.Json(new ErrorResponse("video_too_large", "Video vuot qua 50MB (nen tu dong CHUA duoc cai dat)"), statusCode: 413);
                if (type == MessageType.Voice && file.SizeBytes > VoiceMaxBytes)
                    return Results.Json(new ErrorResponse("voice_too_large", "Voice vuot qua 25MB"), statusCode: 413);
            }

            var message = new Message
            {
                ConversationId = conversationId,
                SenderId = userId,
                Type = type,
                Content = req.Content,
                IsEncrypted = type == MessageType.Text,
                ContentNonce = type == MessageType.Text ? req.ContentNonce : null,
                CreatedAt = DateTimeOffset.UtcNow,
            };
            db.Messages.Add(message);
            conversation.LastMessageAt = message.CreatedAt;
            await db.SaveChangesAsync(); // sau dong nay message.Id da duoc DB gan gia tri that

            if (file is not null)
            {
                file.MessageId = message.Id;
                await db.SaveChangesAsync();
            }

            string? ownRecipientKey = null;
            if (type == MessageType.Text && conversation.Type == ConversationType.Group)
            {
                var keyRows = req.RecipientKeys!.Select(k => new MessageRecipientKey
                {
                    MessageId = message.Id,
                    RecipientUserId = k.UserId,
                    EncryptedKey = k.EncryptedKey,
                });
                db.MessageRecipientKeys.AddRange(keyRows);
                await db.SaveChangesAsync();
                ownRecipientKey = req.RecipientKeys!.FirstOrDefault(k => k.UserId == userId)?.EncryptedKey;
            }

            // Tin nhan Text da ma hoa client-side - Content la ciphertext,
            // KHONG con y nghia gi cho SpamTrackingService phan tich tu khoa/
            // trung lap nua (danh doi da chap nhan cua E2EE that, xem
            // SpamDetector.cs ben SpamTrackingService) - chi truyen null,
            // van giu publish de con tin hieu tan suat gui (rate limit).
            await kafka.PublishChatLogAsync(conversationId, message.Id, userId, req.Type, type == MessageType.Text ? null : req.Content);

            return Results.Created($"/conversations/{conversationId}/messages/{message.Id}",
                MessageResponse.FromEntity(message, fileId: file?.Id, recipientEncryptedKey: ownRecipientKey));
        });

        // UC-28: xoa tin nhan (soft-delete). Group: chi Truong nhom. P2P: chi
        // nguoi gui tu xoa tin cua minh (gia dinh rieng, tai lieu goc chi quy
        // dinh ro cho Group).
        conv.MapDelete("/{conversationId:long}/messages/{messageId:long}", async (long conversationId, long messageId, ClaimsPrincipal principal, ChatDbContext db, WorkspaceClient workspaceClient) =>
        {
            var userId = GetUserId(principal)!.Value;
            var conversation = await db.Conversations.FindAsync(conversationId);
            if (conversation is null)
                return Results.NotFound();

            var message = await db.Messages.SingleOrDefaultAsync(m => m.Id == messageId && m.ConversationId == conversationId);
            if (message is null)
                return Results.NotFound();

            if (conversation.Type == ConversationType.Group)
            {
                if (!await IsLeaderAsync(conversation, userId, workspaceClient))
                    return Results.Json(new ErrorResponse("forbidden", "Chi Truong nhom duoc xoa tin nhan"), statusCode: 403);
            }
            else if (message.SenderId != userId)
            {
                return Results.Json(new ErrorResponse("forbidden", "Chi nguoi gui duoc xoa tin nhan nay"), statusCode: 403);
            }

            message.IsDeleted = true;
            await db.SaveChangesAsync();
            return Results.NoContent();
        });

        // UC-28: mute / unmute - chi Truong nhom
        conv.MapPost("/{conversationId:long}/mutes", async (long conversationId, MuteRequest req, ClaimsPrincipal principal, ChatDbContext db, WorkspaceClient workspaceClient) =>
        {
            var userId = GetUserId(principal)!.Value;
            var conversation = await db.Conversations.FindAsync(conversationId);
            if (conversation is null || conversation.Type != ConversationType.Group)
                return Results.NotFound();

            if (!await IsLeaderAsync(conversation, userId, workspaceClient))
                return Results.Json(new ErrorResponse("forbidden", "Chi Truong nhom duoc cam chat thanh vien"), statusCode: 403);

            if (!await db.MutedMembers.AnyAsync(m => m.ConversationId == conversationId && m.UserId == req.UserId))
            {
                db.MutedMembers.Add(new MutedMember
                {
                    ConversationId = conversationId,
                    UserId = req.UserId,
                    MutedBy = userId,
                    MutedAt = DateTimeOffset.UtcNow,
                });
                await db.SaveChangesAsync();
            }

            return Results.Created($"/conversations/{conversationId}/mutes/{req.UserId}", new { });
        });

        conv.MapDelete("/{conversationId:long}/mutes/{userId:long}", async (long conversationId, long userId, ClaimsPrincipal principal, ChatDbContext db, WorkspaceClient workspaceClient) =>
        {
            var callerId = GetUserId(principal)!.Value;
            var conversation = await db.Conversations.FindAsync(conversationId);
            if (conversation is null || conversation.Type != ConversationType.Group)
                return Results.NotFound();

            if (!await IsLeaderAsync(conversation, callerId, workspaceClient))
                return Results.Json(new ErrorResponse("forbidden", "Chi Truong nhom duoc go mute"), statusCode: 403);

            var mute = await db.MutedMembers.SingleOrDefaultAsync(m => m.ConversationId == conversationId && m.UserId == userId);
            if (mute is not null)
            {
                db.MutedMembers.Remove(mute);
                await db.SaveChangesAsync();
            }
            return Results.NoContent();
        });

        // UC-29: xem/nap/mo khoa dung luong
        conv.MapGet("/{conversationId:long}/storage", async (long conversationId, ClaimsPrincipal principal, ChatDbContext db, WorkspaceClient workspaceClient) =>
        {
            var userId = GetUserId(principal)!.Value;
            var conversation = await db.Conversations.FindAsync(conversationId);
            if (conversation is null || conversation.Type != ConversationType.Group)
                return Results.NotFound();
            if (!await IsMemberAsync(conversation, userId, workspaceClient))
                return Results.Json(new ErrorResponse("forbidden", "Ban khong thuoc nhom nay"), statusCode: 403);

            var settings = await db.GroupChatSettings.FindAsync(conversationId);
            return settings is null ? Results.NotFound() : Results.Ok(StorageInfoResponse.FromEntity(settings));
        });

        conv.MapPost("/{conversationId:long}/storage/topup", async (long conversationId, TopupRequest req, ClaimsPrincipal principal, ChatDbContext db, WorkspaceClient workspaceClient) =>
        {
            var userId = GetUserId(principal)!.Value;
            var conversation = await db.Conversations.FindAsync(conversationId);
            if (conversation is null || conversation.Type != ConversationType.Group)
                return Results.NotFound();
            if (!await IsLeaderAsync(conversation, userId, workspaceClient))
                return Results.Json(new ErrorResponse("forbidden", "Chi Truong nhom duoc nap them dung luong"), statusCode: 403);

            var settings = await db.GroupChatSettings.FindAsync(conversationId);
            if (settings is null)
                return Results.NotFound();

            // Quy doi tien -> bytes: BANG GIA CHUA duoc chot trong tai lieu goc
            // (xem UC-29, ngoai pham vi spec API) - tam quy uoc 1 don vi tien =
            // 1GB de co logic chay duoc, thay bang bang gia that sau.
            const long bytesPerUnit = 1_073_741_824L;
            settings.Plan = StoragePlan.Paid;
            settings.StorageQuotaBytes += (long)(req.Amount * bytesPerUnit);
            settings.IsLocked = false;
            settings.StorageExpiresAt = null;
            settings.LastWarningStage = null;
            settings.UpdatedAt = DateTimeOffset.UtcNow;
            await db.SaveChangesAsync();

            return Results.Ok(StorageInfoResponse.FromEntity(settings));
        });

        conv.MapPost("/{conversationId:long}/storage/unlock", async (long conversationId, UnlockRequest req, ClaimsPrincipal principal, ChatDbContext db, WorkspaceClient workspaceClient) =>
        {
            var userId = GetUserId(principal)!.Value;
            var conversation = await db.Conversations.FindAsync(conversationId);
            if (conversation is null || conversation.Type != ConversationType.Group)
                return Results.NotFound();
            if (!await IsLeaderAsync(conversation, userId, workspaceClient))
                return Results.Json(new ErrorResponse("forbidden", "Chi Truong nhom duoc mo khoa"), statusCode: 403);

            var settings = await db.GroupChatSettings.FindAsync(conversationId);
            if (settings is null)
                return Results.NotFound();

            settings.IsLocked = false;
            settings.StorageExpiresAt = req.StorageExpiresAt;
            settings.LastWarningStage = null;
            settings.UpdatedAt = DateTimeOffset.UtcNow;
            await db.SaveChangesAsync();

            return Results.Ok(StorageInfoResponse.FromEntity(settings));
        });
    }

    internal static async Task<bool> IsMemberAsync(Conversation conversation, long userId, WorkspaceClient workspaceClient)
    {
        if (conversation.Type == ConversationType.P2P)
            return conversation.HasParticipant(userId);

        if (conversation.WorkspaceId is null)
            return false;
        var member = await workspaceClient.GetMemberAsync(conversation.WorkspaceId.Value, userId);
        return member is not null;
    }

    internal static async Task<bool> IsLeaderAsync(Conversation conversation, long userId, WorkspaceClient workspaceClient)
    {
        if (conversation.Type != ConversationType.Group || conversation.WorkspaceId is null)
            return false;
        var member = await workspaceClient.GetMemberAsync(conversation.WorkspaceId.Value, userId);
        return member is { Role: "leader" };
    }

    private static long? GetUserId(ClaimsPrincipal principal)
    {
        var sub = principal.FindFirstValue("sub");
        return sub is not null && long.TryParse(sub, out var id) ? id : null;
    }
}
