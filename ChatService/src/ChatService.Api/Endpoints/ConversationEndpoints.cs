using System.Security.Claims;
using ChatService.Api.Data;
using ChatService.Api.Hubs;
using ChatService.Api.Models;
using ChatService.Api.Services;
using Microsoft.AspNetCore.SignalR;
using Microsoft.EntityFrameworkCore;

namespace ChatService.Api.Endpoints;

public static class ConversationEndpoints
{
    private const long VideoMaxBytes = 50L * 1024 * 1024;
    private const long VoiceMaxBytes = 25L * 1024 * 1024;

    // Khung thoi gian cho phep tu SUA tin nhan cua chinh minh (tu de xuat,
    // tai lieu goc chua chot con so nay).
    //
    // CHI ap dung cho SUA, khong ap dung cho THU HOI. Sua la viet lai lich su
    // nen phai co han; thu hoi chi la go bo nen khong can.
    private static readonly TimeSpan EditWindow = TimeSpan.FromMinutes(15);

    // Tra lai dung luong va xoa han file khi mot tin nhan bien mat vinh vien
    // (thu hoi, hoac Truong nhom xoa).
    //
    // Truoc day chi soft-delete tin nhan: file van nam nguyen tren MinIO va
    // han muc cua nhom van bi tinh cho no. Nguoi dung thu hoi mot video 50MB
    // roi van thay nhom "day" - dung la vo ly.
    //
    // THU TU CO Y: xoa hang `files` TRUOC (trigger trg_files_delete_sync_storage
    // tu tru storage_used_bytes), roi moi xoa object. Neu dao lai ma buoc DB
    // hong thi vua mat file vua khong tra dung luong - hong ca hai dau. Con
    // theo thu tu nay, xau nhat la con lai mot object mo coi tren dia: ton
    // cho nhung ke toan van dung, va dia thi con 439GB.
    //
    // Tra ve fileId da xoa (neu co) de noi goi cap nhat cache cho khop.
    private static async Task<long?> ReleaseFileAsync(
        ChatDbContext db, StorageService storage, ILogger logger, long messageId)
    {
        var file = await db.Files.FirstOrDefaultAsync(f => f.MessageId == messageId);
        if (file is null) return null;

        var (id, provider, key, size) = (file.Id, file.StorageProvider, file.ObjectKey, file.SizeBytes);

        db.Files.Remove(file);
        await db.SaveChangesAsync();

        try
        {
            await storage.DeleteObjectAsync(provider, key);
        }
        catch (Exception ex)
        {
            // Khong nem ra ngoai: dung luong DA duoc tra lai roi, va nguoi
            // dung khong lam gi duoc voi loi nay. Ghi log de con biet ma don.
            logger.LogWarning(ex,
                "Da tra {Size} byte cho nhom nhung KHONG xoa duoc object {Key} o kho {Provider} - con lai file mo coi",
                size, key, provider);
        }

        await UnlockIfUnderQuotaAsync(db, file.ConversationId, logger);
        return id;
    }

    // Mo khoa nhom khi dung luong da tut xuong duoi han muc.
    //
    // Thieu buoc nay thi viec tra dung luong chi co tieng ma khong co mieng:
    // nguoi dung thu hoi mot video 50MB, so byte tra ve dung, nhung nhom van
    // khoa nen van khong gui duoc gi.
    //
    // Don luon HAI thu di kem, giong het nhanh tu mo khoa cua
    // StorageWarningService khi het han:
    //   - StorageExpiresAt: han chot "khong don thi he thong xoa file cu cua
    //     ban". Da du cho roi thi khong con ly do treo ban an do.
    //   - LastWarningStage: de lan sau neu lai day, chuoi canh bao 3d/2d/1d/10h
    //     chay lai tu dau chu khong nhay coc vi tuong da bao roi.
    internal static async Task UnlockIfUnderQuotaAsync(ChatDbContext db, long conversationId, ILogger logger)
    {
        var settings = await db.GroupChatSettings.FindAsync(conversationId);
        if (settings is null) return; // P2P khong co han muc

        // BAT BUOC nap lai: trigger trg_files_delete_sync_storage vua tru
        // storage_used_bytes THANG TRONG CSDL, EF khong he hay biet. Khong nap
        // lai thi doc phai gia tri cu va khong bao gio mo khoa.
        await db.Entry(settings).ReloadAsync();

        if (!settings.IsLocked || settings.StorageUsedBytes >= settings.StorageQuotaBytes)
            return;

        settings.IsLocked = false;
        settings.StorageExpiresAt = null;
        settings.LastWarningStage = null;
        settings.UpdatedAt = DateTimeOffset.UtcNow;
        await db.SaveChangesAsync();

        logger.LogInformation(
            "Mo khoa group conversation {ConversationId}: dung luong con {Used}/{Quota} byte",
            conversationId, settings.StorageUsedBytes, settings.StorageQuotaBytes);
    }

    public static void MapConversationEndpoints(this WebApplication app)
    {
        var conv = app.MapGroup("/conversations").RequireAuthorization();

        // Danh sach hoi thoai cua chinh nguoi goi (P2P + Group) - tu de xuat,
        // thieu sot phat hien khi build man hinh Frontend F2 "Danh sach cuoc
        // tro chuyen" (tai lieu dac ta frontend muc 4). P2P doc thang tu Chat
        // DB (participant_a/b); Group phai hoi WorkSpace Service truoc de
        // biet workspace nao cua minh (Chat Service khong co ban sao
        // workspace_members).
        conv.MapGet("", async (ClaimsPrincipal principal, ChatDbContext db, WorkspaceClient workspaceClient) =>
        {
            var userId = GetUserId(principal)!.Value;

            var myWorkspaceIds = await workspaceClient.GetMyWorkspaceIdsAsync(userId);

            var conversations = await db.Conversations
                .Where(c =>
                    (c.Type == ConversationType.P2P && (c.ParticipantAId == userId || c.ParticipantBId == userId)) ||
                    (c.Type == ConversationType.Group && c.WorkspaceId != null && myWorkspaceIds.Contains(c.WorkspaceId.Value)))
                .OrderByDescending(c => c.LastMessageAt ?? c.CreatedAt)
                .ToListAsync();

            return Results.Ok(conversations.Select(c => ConversationSummaryResponse.FromEntity(c, userId)));
        });

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
        // Route Redis (du lieu nong, <=10.000 tin/<=10 ngay moi conversation)
        // / Postgres (con lai) theo dung tai lieu roadmap muc 6.1 (Search
        // Chat Service) - Redis duoc dong bo bat dong bo qua
        // WriteChatConsumerService (Kafka), CHI dung khi da co DU du lieu
        // cho ca trang hien tai; con lai (cache nguoi/qua han/phan trang sau
        // vao lich su cu) fallback toan bo ve Postgres de dam bao luon dung.
        // Tin nhan CUOI CUNG cua tat ca hoi thoai cua minh, MOT request.
        //
        // Dung cho doan xem truoc duoi moi ten o danh sach ben trai. Server
        // KHONG doc duoc noi dung (tin Text duoc ma hoa dau cuoi) nen chi tra
        // ve nguyen ban ma hoa kem khoa rieng cua nguoi goi - client tu giai
        // ma. Day la ly do khong the lam san doan xem truoc o phia server.
        //
        // Mot request chu khong phai moi hoi thoai mot cai: 30 hoi thoai la 30
        // vong khu hoi qua Cloudflare, do tre cong don thay vi bang thong moi
        // la cai dat.
        conv.MapGet("/last-messages", async (ClaimsPrincipal principal, ChatDbContext db, WorkspaceClient workspaceClient) =>
        {
            var userId = GetUserId(principal)!.Value;

            // Chi nhung hoi thoai nguoi nay thuc su thuoc ve. Dung lai dung
            // phep loc cua GET /conversations de hai cho khong the lech nhau.
            var workspaceIds = await workspaceClient.GetMyWorkspaceIdsAsync(userId);
            var conversations = await db.Conversations
                .Where(c => (c.Type == ConversationType.P2P && (c.ParticipantAId == userId || c.ParticipantBId == userId))
                         || (c.Type == ConversationType.Group && c.WorkspaceId != null && workspaceIds.Contains(c.WorkspaceId.Value)))
                .Select(c => new { c.Id, c.Type })
                .ToListAsync();

            if (conversations.Count == 0)
                return Results.Ok(Array.Empty<LastMessageResponse>());

            var ids = conversations.Select(c => c.Id).ToList();

            // Mot cau cho TAT CA hoi thoai: nhom theo conversation_id roi lay
            // hang moi nhat moi nhom. Lam vong lap N cau thi voi 30 hoi thoai
            // la 30 lan di ve CSDL.
            var lastIds = await db.Messages
                .Where(m => ids.Contains(m.ConversationId))
                .GroupBy(m => m.ConversationId)
                .Select(g => g.OrderByDescending(m => m.CreatedAt).Select(m => m.Id).First())
                .ToListAsync();

            var messages = await db.Messages.Where(m => lastIds.Contains(m.Id)).ToListAsync();

            // Khoa rieng cua CHINH NGUOI GOI cho cac tin nhom - tin 1-1 khong
            // dung bang nay (khoa suy ra tu cap khoa hai ben).
            var groupIds = conversations.Where(c => c.Type == ConversationType.Group).Select(c => c.Id).ToHashSet();
            var encryptedGroupMsgIds = messages
                .Where(m => m.IsEncrypted && groupIds.Contains(m.ConversationId))
                .Select(m => m.Id)
                .ToList();

            var ownKeys = encryptedGroupMsgIds.Count == 0
                ? new Dictionary<long, string>()
                : await db.MessageRecipientKeys
                    .Where(k => encryptedGroupMsgIds.Contains(k.MessageId) && k.RecipientUserId == userId)
                    .ToDictionaryAsync(k => k.MessageId, k => k.EncryptedKey);

            var result = messages.Select(m => new LastMessageResponse(
                m.ConversationId, m.Id, m.SenderId, Message.TypeToString(m.Type), m.Content,
                m.ContentNonce, ownKeys.GetValueOrDefault(m.Id), m.IsEncrypted, m.IsDeleted, m.CreatedAt));

            return Results.Ok(result);
        });

        conv.MapGet("/{conversationId:long}/messages", async (long conversationId, ClaimsPrincipal principal, ChatDbContext db, WorkspaceClient workspaceClient, ChatCacheService cache, DateTimeOffset? before, int? limit) =>
        {
            var userId = GetUserId(principal)!.Value;
            var conversation = await db.Conversations.FindAsync(conversationId);
            if (conversation is null)
                return Results.NotFound();
            if (!await IsMemberAsync(conversation, userId, workspaceClient))
                return Results.Json(new ErrorResponse("forbidden", "Ban khong thuoc cuoc tro chuyen nay"), statusCode: 403);

            var take = Math.Clamp(limit ?? 50, 1, 200);

            List<MessageLite> items;
            var cached = await cache.GetRecentAsync(conversationId, before, take);
            if (cached.Count >= take)
            {
                items = [.. cached.Select(c => new MessageLite(
                    c.Id, c.SenderId, Message.TypeFromString(c.Type), c.Content, c.IsDeleted,
                    c.CreatedAt, c.IsEncrypted, c.ContentNonce, c.FileId, c.IsEdited, c.EditedAt))];
            }
            else
            {
                // MeetingId == null: chi lay tin cua luong chat CHINH. Tin
                // nhan thuoc thao luan cua cuoc hop nam cung bang nhung la
                // luong rieng (xem endpoint /meetings/{id}/messages ben
                // duoi) - khong duoc lan vao day. Nhanh doc tu cache khong
                // can loc vi tin thao luan CO Y khong bao gio duoc ghi vao
                // cache (xem cho gui tin thao luan).
                var query = db.Messages.Where(m => m.ConversationId == conversationId && m.MeetingId == null);
                if (before is not null)
                    query = query.Where(m => m.CreatedAt < before);

                var messages = await query.OrderByDescending(m => m.CreatedAt).Take(take).ToListAsync();
                var fileIds = await db.Files.Where(f => f.ConversationId == conversationId && f.MessageId != null)
                    .ToDictionaryAsync(f => f.MessageId!.Value, f => f.Id);

                items = [.. messages.Select(m => new MessageLite(
                    m.Id, m.SenderId, m.Type, m.Content, m.IsDeleted, m.CreatedAt, m.IsEncrypted, m.ContentNonce,
                    fileIds.TryGetValue(m.Id, out var fid) ? fid : null, m.IsEdited, m.EditedAt))];
            }

            // E2EE Group: moi user chi duoc thay khoa phien DA MA HOA CHO
            // CHINH MINH, khong thay khoa cua nguoi khac (moi nguoi 1 ban ma
            // hoa rieng, xem MessageRecipientKey.cs).
            Dictionary<long, string>? ownRecipientKeys = null;
            if (conversation.Type == ConversationType.Group)
            {
                var messageIds = items.Where(m => m.IsEncrypted).Select(m => m.Id).ToList();
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

            var result = items.Select(m =>
            {
                string? displayName = null;
                if (conversation.Type == ConversationType.Group && m.SenderId is not null)
                {
                    displayName = currentMembers is not null && currentMembers.TryGetValue(m.SenderId.Value, out var info)
                        ? info.Nickname
                        : "người trong nhóm";
                }
                var recipientKey = ownRecipientKeys?.GetValueOrDefault(m.Id);
                return MessageResponse.FromLite(m, conversationId, displayName, recipientKey);
            });

            return Results.Ok(result);
        });

        // UC-25 (P2P) / UC-27 (Group): gui tin nhan
        conv.MapPost("/{conversationId:long}/messages", async (
            long conversationId, CreateMessageRequest req, ClaimsPrincipal principal, ChatDbContext db,
            KafkaProducerService kafka, WorkspaceClient workspaceClient, IHubContext<ChatHub> hub,
            ChatMessageNotificationPublisher notifyPublisher, PresenceTracker presence) =>
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

            // Blind-index search token (tu de xuat, xem MessageSearchToken.cs) -
            // client tu bam tu khoa bang search-key rieng TRUOC khi ma hoa,
            // server chi luu/so khop nguyen token, khong biet duoc tu goc.
            if (type == MessageType.Text && req.SearchTokens is { Count: > 0 })
            {
                db.MessageSearchTokens.AddRange(req.SearchTokens.Select(t => new MessageSearchToken
                {
                    MessageId = message.Id,
                    Token = t,
                }));
                await db.SaveChangesAsync();
            }

            // Tin nhan Text da ma hoa client-side - Content la ciphertext,
            // KHONG con y nghia gi cho SpamTrackingService phan tich tu khoa/
            // trung lap nua (danh doi da chap nhan cua E2EE that, xem
            // SpamDetector.cs ben SpamTrackingService) - chi truyen null,
            // van giu publish de con tin hieu tan suat gui (rate limit).
            await kafka.PublishChatLogAsync(conversationId, message.Id, userId, req.Type, type == MessageType.Text ? null : req.Content);

            var response = MessageResponse.FromEntity(message, fileId: file?.Id, recipientEncryptedKey: ownRecipientKey);

            // Realtime: broadcast cho ca group dang mo man hinh chat nay (tu
            // de xuat - hoan thanh muc "WebSocket cho realtime tin nhan"
            // con thieu trong tai lieu roadmap muc 6.4). Nguoi nhan tu client
            // se khong thay recipientEncryptedKey cua chinh minh qua kenh nay
            // (broadcast dung CHUNG 1 payload cho ca group) - client can goi
            // lai GET messages hoac Chat Service can gui rieng qua kenh
            // 1-nguoi neu muon E2EE Group nhan duoc khoa realtime; hien tai
            // client chi nhan duoc "co tin nhan moi" va tu fetch lai qua REST
            // de lay dung khoa cua minh.
            await hub.Clients.Group(ChatHub.GroupName(conversationId)).SendAsync("MessageReceived", response with { RecipientEncryptedKey = null });

            // RabbitMQ: thong bao tin nhan moi -> Identity Service, noi dong
            // vai tro dau moi notification cua ca he thong (roadmap muc 1 va
            // bang Publisher -> Consumer muc 8.1). Identity luu lai roi day
            // tiep xuong tung nguoi nhan qua WebSocket.
            //
            // Day KHONG phai duong realtime cua khung chat dang mo (do la
            // SignalR o tren) - no danh cho nguoi khong mo phong chat do,
            // hoac dang offline va se doc thong bao khi quay lai.
            // Bo qua nguoi DANG MO chinh phong chat nay: ho vua thay tin nhan
            // hien ra truoc mat qua SignalR o tren, them mot dong thong bao
            // nua chi lam chuong bao keu vo nghia. Khong loc buoc nay thi mot
            // nhom dong nguoi dang tro chuyen se sinh ra mot thong bao cho
            // TUNG thanh vien tren MOI tin nhan.
            var recipients = await RecipientsAsync(conversation, userId, workspaceClient);
            recipients = [.. recipients.Where(id => !presence.IsViewing(conversationId, id))];
            await notifyPublisher.PublishAsync(conversationId, message.Id, userId, req.Type, GetNickname(principal), recipients);

            return Results.Created($"/conversations/{conversationId}/messages/{message.Id}", response);
        });

        // UC-28: xoa tin nhan (soft-delete). Group: chi Truong nhom. P2P: chi
        // nguoi gui tu xoa tin cua minh (gia dinh rieng, tai lieu goc chi quy
        // dinh ro cho Group).
        conv.MapDelete("/{conversationId:long}/messages/{messageId:long}", async (long conversationId, long messageId, ClaimsPrincipal principal, ChatDbContext db, WorkspaceClient workspaceClient, IHubContext<ChatHub> hub, ChatCacheService cache, StorageService storage, ILoggerFactory loggerFactory) =>
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

            // Giong thu hoi: xoa han la mat vinh vien nen phai tra dung luong
            // va don file. Truong nhom xoa mot video 50MB cua thanh vien ma
            // nhom khong nhe ra duoc thi con vo ly hon.
            await ReleaseFileAsync(db, storage, loggerFactory.CreateLogger(typeof(ConversationEndpoints)), message.Id);

            // Cap nhat truc tiep cache Redis (khong qua Kafka - day la update
            // nho, khong can tach write path nhu luc tao tin nhan moi).
            await cache.UpdateCachedMessageAsync(new CachedMessage(
                message.Id, message.ConversationId, message.SenderId, Message.TypeToString(message.Type),
                message.Content, null, message.IsDeleted, message.CreatedAt, message.IsEncrypted, message.ContentNonce,
                message.IsEdited, message.EditedAt));

            await hub.Clients.Group(ChatHub.GroupName(conversationId)).SendAsync("MessageDeleted", messageId);
            return Results.NoContent();
        });

        // Tu de xuat (mo rong UC-28) - "thu hoi" tin nhan cua CHINH MINH,
        // khac voi xoa o tren (danh cho Truong nhom, ap dung cho MOI tin nhan
        // trong Group). Recall: BAT KY sender nao (ca P2P lan Group) tu thu
        // hoi tin CUA MINH, KHONG gioi han thoi gian.
        conv.MapPost("/{conversationId:long}/messages/{messageId:long}/recall", async (long conversationId, long messageId, ClaimsPrincipal principal, ChatDbContext db, WorkspaceClient workspaceClient, IHubContext<ChatHub> hub, ChatCacheService cache, StorageService storage, ILoggerFactory loggerFactory) =>
        {
            var userId = GetUserId(principal)!.Value;
            var conversation = await db.Conversations.FindAsync(conversationId);
            if (conversation is null)
                return Results.NotFound();
            if (!await IsMemberAsync(conversation, userId, workspaceClient))
                return Results.Json(new ErrorResponse("forbidden", "Ban khong thuoc cuoc tro chuyen nay"), statusCode: 403);

            var message = await db.Messages.SingleOrDefaultAsync(m => m.Id == messageId && m.ConversationId == conversationId);
            if (message is null || message.IsDeleted)
                return Results.NotFound();

            if (message.SenderId != userId)
                return Results.Json(new ErrorResponse("forbidden", "Chi nguoi gui duoc thu hoi tin nhan nay"), statusCode: 403);

            // KHONG gioi han thoi gian. Truoc day thu hoi dung chung
            // EditWindow 15 phut voi sua tin nhan, nhung hai viec nay khac
            // ban chat: SUA la viet lai lich su (tin cu doi noi dung ma nguoi
            // doc khong hay biet), con THU HOI chi la go bo - noi dung bien
            // mat, khong ai bi dan sai. Zalo/Messenger cung cho thu hoi bat
            // ky luc nao.
            //
            // Frontend van luon hien nut "Thu hoi" cho tin cua chinh minh, nen
            // moc 15 phut chi tao ra canh bam nut roi an loi 422.

            message.IsDeleted = true;
            await db.SaveChangesAsync();

            // Thu hoi la mat vinh vien -> tra lai dung luong va xoa file that.
            await ReleaseFileAsync(db, storage, loggerFactory.CreateLogger(typeof(ConversationEndpoints)), message.Id);

            // fileId = null: file da bi xoa han, khong con gi de tro toi.
            await cache.UpdateCachedMessageAsync(new CachedMessage(
                message.Id, message.ConversationId, message.SenderId, Message.TypeToString(message.Type),
                message.Content, null, message.IsDeleted, message.CreatedAt, message.IsEncrypted, message.ContentNonce,
                message.IsEdited, message.EditedAt));

            await hub.Clients.Group(ChatHub.GroupName(conversationId)).SendAsync("MessageDeleted", messageId);
            return Results.NoContent();
        });

        // Tu de xuat - "sua" tin nhan Text da gui (chi sender, trong
        // EditWindow). Client tu ma hoa lai noi dung (nonce moi, TAI SU DUNG
        // session key cu neu la Group - khong can gui lai RecipientKeys).
        conv.MapPatch("/{conversationId:long}/messages/{messageId:long}", async (long conversationId, long messageId, UpdateMessageRequest req, ClaimsPrincipal principal, ChatDbContext db, WorkspaceClient workspaceClient, IHubContext<ChatHub> hub, ChatCacheService cache) =>
        {
            var userId = GetUserId(principal)!.Value;
            var conversation = await db.Conversations.FindAsync(conversationId);
            if (conversation is null)
                return Results.NotFound();
            if (!await IsMemberAsync(conversation, userId, workspaceClient))
                return Results.Json(new ErrorResponse("forbidden", "Ban khong thuoc cuoc tro chuyen nay"), statusCode: 403);

            var message = await db.Messages.SingleOrDefaultAsync(m => m.Id == messageId && m.ConversationId == conversationId);
            if (message is null || message.IsDeleted)
                return Results.NotFound();

            if (message.SenderId != userId)
                return Results.Json(new ErrorResponse("forbidden", "Chi nguoi gui duoc sua tin nhan nay"), statusCode: 403);

            if (message.Type != MessageType.Text)
                return Results.Json(new ErrorResponse("not_editable", "Chi tin nhan Text moi sua duoc"), statusCode: 422);

            if (DateTimeOffset.UtcNow - message.CreatedAt > EditWindow)
                return Results.Json(new ErrorResponse("edit_window_expired", $"Chi sua duoc trong {EditWindow.TotalMinutes} phut sau khi gui"), statusCode: 422);

            if (string.IsNullOrWhiteSpace(req.Content) || string.IsNullOrWhiteSpace(req.ContentNonce))
                return Results.BadRequest(new ErrorResponse("invalid_request", "Tin nhan Text bat buoc phai ma hoa (content + contentNonce)"));

            message.Content = req.Content;
            message.ContentNonce = req.ContentNonce;
            message.IsEdited = true;
            message.EditedAt = DateTimeOffset.UtcNow;
            await db.SaveChangesAsync();

            var oldTokens = db.MessageSearchTokens.Where(t => t.MessageId == message.Id);
            db.MessageSearchTokens.RemoveRange(oldTokens);
            if (req.SearchTokens is { Count: > 0 })
            {
                db.MessageSearchTokens.AddRange(req.SearchTokens.Select(t => new MessageSearchToken
                {
                    MessageId = message.Id,
                    Token = t,
                }));
            }
            await db.SaveChangesAsync();

            var fileId = await db.Files.Where(f => f.MessageId == message.Id).Select(f => (long?)f.Id).FirstOrDefaultAsync();
            await cache.UpdateCachedMessageAsync(new CachedMessage(
                message.Id, message.ConversationId, message.SenderId, Message.TypeToString(message.Type),
                message.Content, fileId, message.IsDeleted, message.CreatedAt, message.IsEncrypted, message.ContentNonce,
                message.IsEdited, message.EditedAt));

            // RecipientEncryptedKey giu nguyen (khoa phien khong doi khi
            // sua), lay lai tu MessageRecipientKeys cho rieng sender de tra
            // ve dung hinh dang MessageResponse - broadcast van strip di
            // (giong POST) vi moi nguoi trong Group co ban ma hoa khoa
            // rieng khac nhau.
            var response = MessageResponse.FromEntity(message, fileId: fileId);
            await hub.Clients.Group(ChatHub.GroupName(conversationId)).SendAsync("MessageEdited", response);

            return Results.Ok(response);
        });

        // Tu de xuat - tim kiem tin nhan trong 1 conversation (muc "chua co
        // endpoint" da neu trong frontend-admin-page-dac-ta.md muc 5). Vi
        // tin nhan Text luon E2EE (content la ciphertext), server KHONG the
        // full-text search - dung blind-index: query param "tokens" la danh
        // sach token DA BAM SAN boi client (cung search-key da dung luc gui
        // tin), server chi so khop token == token (AND - tin nhan phai chua
        // DU tat ca token duoc truyen vao). Cac filter con lai (senderId,
        // type, from/to) hoat dong binh thuong tren metadata (khong ma
        // hoa) - dung duoc doc lap voi tokens, ke ca voi tin non-Text.
        conv.MapGet("/{conversationId:long}/messages/search", async (
            long conversationId, ClaimsPrincipal principal, ChatDbContext db, WorkspaceClient workspaceClient,
            string? tokens, long? senderId, string? type, DateTimeOffset? from, DateTimeOffset? to, int? limit) =>
        {
            var userId = GetUserId(principal)!.Value;
            var conversation = await db.Conversations.FindAsync(conversationId);
            if (conversation is null)
                return Results.NotFound();
            if (!await IsMemberAsync(conversation, userId, workspaceClient))
                return Results.Json(new ErrorResponse("forbidden", "Ban khong thuoc cuoc tro chuyen nay"), statusCode: 403);

            var take = Math.Clamp(limit ?? 50, 1, 200);
            var query = db.Messages.Where(m => m.ConversationId == conversationId && !m.IsDeleted);

            if (senderId is not null)
                query = query.Where(m => m.SenderId == senderId);
            if (type is not null)
                query = query.Where(m => m.Type == Message.TypeFromString(type));
            if (from is not null)
                query = query.Where(m => m.CreatedAt >= from);
            if (to is not null)
                query = query.Where(m => m.CreatedAt <= to);

            var tokenList = string.IsNullOrWhiteSpace(tokens)
                ? []
                : tokens.Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries);

            if (tokenList.Length > 0)
            {
                query = query.Where(m => db.MessageSearchTokens
                    .Where(t => t.MessageId == m.Id && tokenList.Contains(t.Token))
                    .Select(t => t.Token)
                    .Distinct()
                    .Count() == tokenList.Length);
            }

            var messages = await query.OrderByDescending(m => m.CreatedAt).Take(take).ToListAsync();
            var fileIds = await db.Files.Where(f => f.ConversationId == conversationId && f.MessageId != null)
                .ToDictionaryAsync(f => f.MessageId!.Value, f => f.Id);

            Dictionary<long, string>? ownRecipientKeys = null;
            if (conversation.Type == ConversationType.Group)
            {
                var messageIds = messages.Where(m => m.IsEncrypted).Select(m => m.Id).ToList();
                ownRecipientKeys = await db.MessageRecipientKeys
                    .Where(k => messageIds.Contains(k.MessageId) && k.RecipientUserId == userId)
                    .ToDictionaryAsync(k => k.MessageId, k => k.EncryptedKey);
            }

            var result = messages.Select(m => MessageResponse.FromEntity(
                m, fileId: fileIds.TryGetValue(m.Id, out var fid) ? fid : null,
                recipientEncryptedKey: ownRecipientKeys?.GetValueOrDefault(m.Id)));

            return Results.Ok(result);
        });

        // Danh sach dang bi mute - tu de xuat, thieu sot phat hien khi build
        // Frontend F4: co POST/DELETE mute nhung khong co cach nao XEM lai
        // ai dang bi mute.
        conv.MapGet("/{conversationId:long}/mutes", async (long conversationId, ClaimsPrincipal principal, ChatDbContext db, WorkspaceClient workspaceClient) =>
        {
            var userId = GetUserId(principal)!.Value;
            var conversation = await db.Conversations.FindAsync(conversationId);
            if (conversation is null || conversation.Type != ConversationType.Group)
                return Results.NotFound();
            if (!await IsMemberAsync(conversation, userId, workspaceClient))
                return Results.Json(new ErrorResponse("forbidden", "Ban khong thuoc nhom nay"), statusCode: 403);

            var muted = await db.MutedMembers.Where(m => m.ConversationId == conversationId).Select(m => m.UserId).ToListAsync();
            return Results.Ok(muted);
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

        // Nap them dung luong - DOI THIET KE theo yeu cau nguoi dung du an:
        // Truong nhom KHONG con tu cong duoc nua, chi GUI YEU CAU (giong nap
        // tien that can nguoi xac nhan da nhan tien) - Admin duyet moi thuc
        // su cong dung luong, xem endpoint /internal/storage-topup-requests
        // ben duoi (AdminService.Api goi vao).
        conv.MapPost("/{conversationId:long}/storage/topup-requests", async (long conversationId, TopupRequest req, ClaimsPrincipal principal, ChatDbContext db, WorkspaceClient workspaceClient) =>
        {
            var userId = GetUserId(principal)!.Value;
            var conversation = await db.Conversations.FindAsync(conversationId);
            if (conversation is null || conversation.Type != ConversationType.Group)
                return Results.NotFound();
            if (!await IsLeaderAsync(conversation, userId, workspaceClient))
                return Results.Json(new ErrorResponse("forbidden", "Chi Truong nhom duoc gui yeu cau nap them dung luong"), statusCode: 403);

            var settings = await db.GroupChatSettings.FindAsync(conversationId);
            if (settings is null)
                return Results.NotFound();

            var request = new StorageTopupRequest
            {
                ConversationId = conversationId,
                RequestedBy = userId,
                Amount = req.Amount,
                Status = TopupRequestStatus.Pending,
                CreatedAt = DateTimeOffset.UtcNow,
            };
            db.StorageTopupRequests.Add(request);
            await db.SaveChangesAsync();

            return Results.Created($"/conversations/{conversationId}/storage/topup-requests/{request.Id}",
                new TopupRequestResponse(request.Id, request.ConversationId, request.RequestedBy, request.Amount, "pending", request.CreatedAt));
        });

        conv.MapGet("/{conversationId:long}/storage/topup-requests", async (long conversationId, ClaimsPrincipal principal, ChatDbContext db, WorkspaceClient workspaceClient) =>
        {
            var userId = GetUserId(principal)!.Value;
            var conversation = await db.Conversations.FindAsync(conversationId);
            if (conversation is null || conversation.Type != ConversationType.Group)
                return Results.NotFound();
            if (!await IsMemberAsync(conversation, userId, workspaceClient))
                return Results.Json(new ErrorResponse("forbidden", "Ban khong thuoc nhom nay"), statusCode: 403);

            var requests = await db.StorageTopupRequests
                .Where(r => r.ConversationId == conversationId)
                .OrderByDescending(r => r.CreatedAt)
                .ToListAsync();

            return Results.Ok(requests.Select(r => new TopupRequestResponse(
                r.Id, r.ConversationId, r.RequestedBy, r.Amount,
                r.Status == TopupRequestStatus.Pending ? "pending" : r.Status == TopupRequestStatus.Approved ? "approved" : "rejected",
                r.CreatedAt)));
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

    // Ai can duoc bao khi co tin nhan/su kien moi trong hoi thoai nay: moi
    // thanh vien TRU nguoi gay ra su kien (khong ai can thong bao ve viec
    // chinh minh vua lam).
    //
    // Tinh o phia Chat Service chu khong de Identity Service tu tra: Identity
    // khong co ban sao thanh vien nhom, de no hoi nguoc lai la tao vong phu
    // thuoc va thong bao se chet neu Chat dang ban.
    internal static async Task<List<long>> RecipientsAsync(Conversation conversation, long excludeUserId, WorkspaceClient workspaceClient)
    {
        if (conversation.Type == ConversationType.P2P)
        {
            var other = conversation.ParticipantAId == excludeUserId ? conversation.ParticipantBId : conversation.ParticipantAId;
            return other is null ? [] : [other.Value];
        }

        if (conversation.WorkspaceId is null)
            return [];

        var members = await workspaceClient.GetMembersAsync(conversation.WorkspaceId.Value);
        return members is null ? [] : [.. members.Select(m => m.UserId).Where(id => id != excludeUserId)];
    }

    // JWT do Identity Service phat co san claim "nickname" - dung de thong bao
    // doc duoc ten nguoi gui ma khong phai goi sang Identity.
    internal static string? GetNickname(ClaimsPrincipal principal) => principal.FindFirstValue("nickname");

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
