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
        app.MapPost("/files/upload-url", async (UploadUrlRequest req, ClaimsPrincipal principal, ChatDbContext db, StorageService storage, WorkspaceClient workspaceClient, MediaServiceClient mediaClient) =>
        {
            var userId = GetUserId(principal)!.Value;
            var conversation = await db.Conversations.FindAsync(req.ConversationId);
            if (conversation is null)
                return Results.BadRequest(new ErrorResponse("invalid_conversation", "conversationId khong hop le"));

            // Gui file trong luong THAO LUAN cua cuoc hop thi kiem tra theo
            // nhanh rieng (khach vang lai khong thuoc workspace nhung van
            // duoc gui file). File van gan vao conversation nhu binh thuong
            // nen phan kiem tra han muc luu tru ben duoi KHONG doi gi - dung
            // yeu cau "file cung tinh vao 2GB tong cua nhom".
            var allowed = req.MeetingId is not null
                ? await MeetingDiscussionEndpoints.CanAccessAsync(conversation, req.MeetingId.Value, userId, workspaceClient, mediaClient)
                : await ConversationEndpoints.IsMemberAsync(conversation, userId, workspaceClient);
            if (!allowed)
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
                    // Kem CON SO vao thong bao. Truoc day chi noi "vuot qua
                    // han muc" - nguoi dung khong biet tep cua minh to bao
                    // nhieu, nhom con trong bao nhieu, phai xoa bot bao nhieu
                    // thi moi gui duoc. Frontend dung nguyen chuoi nay lam noi
                    // dung popup.
                    if (settings.IsLocked)
                        return Results.Json(new ErrorResponse(
                            "storage_locked",
                            $"Nhóm đang bị khoá vì hết dung lượng ({Human(settings.StorageUsedBytes)}/{Human(settings.StorageQuotaBytes)}). " +
                            "Trưởng nhóm cần nạp thêm, hoặc thu hồi bớt tệp cũ — dung lượng tụt xuống dưới hạn mức là nhóm tự mở khoá."),
                            statusCode: 507);

                    var freeBytes = Math.Max(0, settings.StorageQuotaBytes - settings.StorageUsedBytes);
                    if (settings.StorageUsedBytes + req.SizeBytes > settings.StorageQuotaBytes)
                        return Results.Json(new ErrorResponse(
                            "storage_quota_exceeded",
                            $"Tệp {Human(req.SizeBytes)} lớn hơn chỗ trống của nhóm. " +
                            $"Nhóm đã dùng {Human(settings.StorageUsedBytes)}/{Human(settings.StorageQuotaBytes)}, chỉ còn trống {Human(freeBytes)}. " +
                            $"Hãy thu hồi bớt tệp cũ để lấy lại chỗ, hoặc nhờ Trưởng nhóm nạp thêm dung lượng."),
                            statusCode: 507);
                }
            }

            // Chon kho luu tru theo dung luong TRUOC khi insert, roi ghi thang
            // vao hang - luc tai ve chi doc lai cot nay, khong tinh lai theo
            // nguong. Nho vay doi nguong sau nay khong lam hong file cu (file
            // 30MB da nam o cloud van tai ve tu cloud du nguong co tang len).
            var provider = storage.ResolveProviderForUpload(req.SizeBytes);

            var file = new FileAttachment
            {
                ConversationId = req.ConversationId,
                UploadedBy = userId,
                ObjectKey = $"{req.ConversationId}/{Guid.NewGuid():N}",
                // Cat bot cho vua cot VARCHAR(255). Ten file dai bat thuong
                // thi thu nhat la hiem, thu hai la chi de hien - cat con hon
                // de ca lan upload hong vi mot chuoi qua dai.
                FileName = string.IsNullOrWhiteSpace(req.FileName)
                    ? null
                    : req.FileName.Trim()[..Math.Min(req.FileName.Trim().Length, 255)],
                FileType = fileType,
                SizeBytes = req.SizeBytes,
                UploadedAt = DateTimeOffset.UtcNow,
                StorageProvider = provider,
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

            var expiry = storage.PresignExpiryFor(file.SizeBytes);

            // File nho: mot lan PUT nhu cu.
            if (file.SizeBytes < StorageService.MultipartThresholdBytes)
            {
                var uploadUrl = storage.GeneratePresignedUploadUrl(file.StorageProvider, file.ObjectKey, file.SizeBytes);
                return Results.Ok(new UploadUrlResponse(file.Id, uploadUrl, expiry));
            }

            // File lon: cat thanh nhieu phan. Xem StorageService de biet vi
            // sao - tom tat: Cloudflare chi cho origin ~100 giay tra loi mot
            // request, ma kho luu tru chi tra loi sau khi nhan xong het file.
            var uploadId = await storage.InitiateMultipartAsync(file.StorageProvider, file.ObjectKey);

            // Ghi lai ngay: neu lan tai nay bi bo do thi bo quet can dung ma
            // nay de huy dich danh, khong phai di liet ke va doan.
            file.UploadId = uploadId;
            await db.SaveChangesAsync();

            var partCount = StorageService.PartCountFor(file.SizeBytes);
            var partUrls = new string[partCount];
            for (var i = 0; i < partCount; i++)
                partUrls[i] = storage.GeneratePresignedPartUrl(file.StorageProvider, file.ObjectKey, uploadId, i + 1, expiry);

            return Results.Ok(new UploadUrlResponse(
                file.Id, partUrls[0], expiry, uploadId, StorageService.PartSizeBytes, partUrls));
        }).RequireAuthorization();

        // Ghep cac phan lai sau khi client da PUT xong het.
        //
        // Chua ghep thi object CHUA TON TAI o kho luu tru - cac phan chi nam
        // roi rac. Nen buoc nay bat buoc, va neu client bo giua chung thi cac
        // phan do treo lai; MinIO co lifecycle rule don multipart do dang,
        // hoac goi POST .../abort-upload.
        app.MapPost("/files/{fileId:long}/complete-upload", async (
            long fileId, CompleteUploadRequest req, ClaimsPrincipal principal,
            ChatDbContext db, StorageService storage) =>
        {
            var userId = GetUserId(principal)!.Value;
            var file = await db.Files.FindAsync(fileId);
            if (file is null)
                return Results.NotFound();

            // Chi nguoi da xin URL moi duoc ghep - khong de nguoi khac ket
            // thuc ho mot lan tai len dang do.
            if (file.UploadedBy != userId)
                return Results.Json(new ErrorResponse("forbidden", "Khong phai nguoi tai len tep nay"), statusCode: 403);

            if (string.IsNullOrWhiteSpace(req.UploadId))
                return Results.BadRequest(new ErrorResponse("invalid_request", "Thieu uploadId"));

            try
            {
                await storage.CompleteMultipartAsync(file.StorageProvider, file.ObjectKey, req.UploadId);
            }
            catch (Exception ex)
            {
                return Results.UnprocessableEntity(new ErrorResponse("complete_failed", $"Khong ghep duoc cac phan: {ex.Message}"));
            }

            return Results.NoContent();
        }).RequireAuthorization();

        // Bao "lan tai len nay VAN DANG CHAY".
        //
        // Cac phan bay THANG toi kho luu tru bang URL da ky, server khong he
        // thay chung - nen day la tin hieu song DUY NHAT ma server co. Thieu
        // no thi server phai doi toi khi URL da ky het han moi dam ket luan
        // la nguoi dung da bo cuoc: voi mot tep 864MB la 44 phut, suot ca 44
        // phut do dung luong van bi tru.
        //
        // Co y lam that re: mot cau UPDATE, khong nap thuc the, khong tra ve
        // gi. Client goi 15 giay mot lan.
        //
        // Tra 404 khi khong con hang nao khop (da gui xong, hoac da bi don) -
        // client hieu la "thoi dap di".
        app.MapPost("/files/{fileId:long}/heartbeat", async (
            long fileId, ClaimsPrincipal principal, ChatDbContext db) =>
        {
            var userId = GetUserId(principal)!.Value;
            var now = DateTimeOffset.UtcNow;
            var updated = await db.Files
                .Where(f => f.Id == fileId && f.UploadedBy == userId && f.MessageId == null)
                .ExecuteUpdateAsync(s => s.SetProperty(f => f.LastHeartbeatAt, now));
            return updated == 0 ? Results.NotFound() : Results.NoContent();
        }).RequireAuthorization();

        // Huy mot lan tai len dang do: TRA LAI DUNG LUONG va don sach kho.
        //
        // Ban truoc chi huy multipart ma KHONG xoa hang `files`, nen nguoi
        // dung bam huy xong van bi tru nguyen dung luong - dung cai bug ma
        // buoc nay le ra phai chua. Gio di qua ReleasePendingAsync nhu bo
        // quet, hai duong cung mot loi.
        app.MapPost("/files/{fileId:long}/abort-upload", async (
            long fileId, AbortUploadRequest? req, ClaimsPrincipal principal,
            ChatDbContext db, StorageService storage, ILoggerFactory loggerFactory) =>
        {
            var userId = GetUserId(principal)!.Value;
            var file = await db.Files.FindAsync(fileId);
            // Da don roi thi coi nhu xong - buoc huy phai goi bao nhieu lan
            // cung duoc, vi client co the vua gui luc dong trang vua gui lai
            // o nhanh bat loi.
            if (file is null)
                return Results.NoContent();
            if (file.UploadedBy != userId)
                return Results.Json(new ErrorResponse("forbidden", "Khong phai nguoi tai len tep nay"), statusCode: 403);

            // Da gan vao mot tin nhan roi thi day khong con la "dang tai len"
            // nua. Khong duoc xoa: mot request huy toi muon se lam bay mat
            // mot tep DA GUI THANH CONG.
            if (file.MessageId is not null)
                return Results.Json(new ErrorResponse("already_sent", "Tep nay da duoc gui, khong huy duoc"), statusCode: 409);

            await ReleasePendingAsync(
                db, storage, loggerFactory.CreateLogger(typeof(FileEndpoints)), file, req?.UploadId);
            return Results.NoContent();
        }).RequireAuthorization();

        // Tu de xuat - thieu sot phat hien khi build Frontend F2: co upload
        // (PUT) nhung khong co cach nao lay URL de XEM lai file da gui.
        // Kiem tra quyen qua ConversationId cua chinh file do (khong nhan
        // conversationId tu client de tranh gia mao).
        app.MapGet("/files/{fileId:long}/download-url", async (long fileId, ClaimsPrincipal principal, ChatDbContext db, StorageService storage, WorkspaceClient workspaceClient, MediaServiceClient mediaClient) =>
        {
            var userId = GetUserId(principal)!.Value;
            var file = await db.Files.FindAsync(fileId);
            if (file is null)
                return Results.NotFound();

            var conversation = await db.Conversations.FindAsync(file.ConversationId);
            if (conversation is null)
                return Results.Json(new ErrorResponse("forbidden", "Ban khong thuoc cuoc tro chuyen chua file nay"), statusCode: 403);

            // File dinh kem trong thao luan cua cuoc hop: khach vang lai
            // khong thuoc workspace nhung phai xem duoc file nguoi khac gui
            // trong dung thao luan do. Lay meetingId tu CHINH tin nhan chua
            // file (khong nhan tu client - tranh gia mao).
            var attachedMeetingId = file.MessageId is null
                ? null
                : await db.Messages.Where(m => m.Id == file.MessageId).Select(m => m.MeetingId).FirstOrDefaultAsync();

            var allowed = attachedMeetingId is not null
                ? await MeetingDiscussionEndpoints.CanAccessAsync(conversation, attachedMeetingId.Value, userId, workspaceClient, mediaClient)
                : await ConversationEndpoints.IsMemberAsync(conversation, userId, workspaceClient);
            if (!allowed)
                return Results.Json(new ErrorResponse("forbidden", "Ban khong thuoc cuoc tro chuyen chua file nay"), statusCode: 403);

            // Presign vao DUNG kho da ghi trong hang. Neu kho do khong con
            // cau hinh thi bao 503 that ro - khong duoc am tham chuyen sang
            // kho khac, vi nhu vay se tra ve URL tro toi object khong ton tai
            // va nguoi dung nhan 404 tu MinIO ma khong hieu vi sao.
            string url;
            try
            {
                // Truyen ten goc de trinh duyet luu dung ten. Khong truyen thi
                // nguoi dung nhan mot file ten la GUID khong duoi mo rong -
                // trong het nhu file hong.
                url = storage.GeneratePresignedDownloadUrl(
                    file.StorageProvider, file.ObjectKey, file.SizeBytes, file.FileName);
            }
            catch (StorageProviderUnavailableException ex)
            {
                return Results.Json(
                    new ErrorResponse("storage_unavailable", $"Kho luu tru '{ex.Provider}' chua duoc cau hinh"),
                    statusCode: 503);
            }
            return Results.Ok(new UploadUrlResponse(
                file.Id, url, storage.PresignExpiryFor(file.SizeBytes),
                FileName: file.FileName, SizeBytes: file.SizeBytes));
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

    // Tra lai dung luong va don sach mot lan tai len CHUA HOAN TAT.
    //
    // Dung chung cho hai duong: nguoi dung/trinh duyet bao huy (abort-upload)
    // va bo quet tu phat hien (AbandonedUploadCleanupService). Mot ham thi
    // hai duong khong the lech nhau.
    //
    // THU TU CO Y - xoa hang `files` TRUOC, roi moi dong vao kho:
    // trigger trg_files_delete_sync_storage tu tra lai storage_used_bytes
    // ngay khi hang bien mat. Neu dao lai ma buoc DB hong thi vua mat file
    // vua khong tra dung luong. Theo thu tu nay, xau nhat chi con mot object
    // mo coi tren dia - luot quet mo coi se don, va ke toan van dung.
    internal static async Task ReleasePendingAsync(
        ChatDbContext db, StorageService storage, ILogger logger,
        FileAttachment file, string? uploadIdHint = null, CancellationToken ct = default)
    {
        var (id, provider, key, size, conversationId) =
            (file.Id, file.StorageProvider, file.ObjectKey, file.SizeBytes, file.ConversationId);

        // Uu tien ma da luu trong DB; uploadIdHint chi la duong lui cho cac
        // hang co truoc khi co cot upload_id.
        var uploadId = file.UploadId ?? uploadIdHint;

        db.Files.Remove(file);
        await db.SaveChangesAsync(ct);

        try
        {
            // Tep lon di duong nhieu phan: object chinh CHUA TUNG ton tai,
            // cai dang an dia la cac phan da tai len - phai huy dich danh.
            if (!string.IsNullOrEmpty(uploadId))
                await storage.AbortMultipartAsync(provider, key, uploadId, ct);
            else
                await storage.DeleteObjectAsync(provider, key, ct);
        }
        catch (Exception ex)
        {
            logger.LogWarning(ex,
                "Da tra {Size} byte cho hoi thoai {ConversationId} nhung khong don duoc {Key}",
                size, conversationId, key);
        }

        // Tra dung luong xong ma nhom van khoa thi cung nhu khong.
        await ConversationEndpoints.UnlockIfUnderQuotaAsync(db, conversationId, logger);

        logger.LogInformation(
            "Da huy lan tai len do dang: file {FileId} ({Size} byte) cua hoi thoai {ConversationId}",
            id, size, conversationId);
    }

    // Doi byte sang chuoi nguoi doc duoc. Dat o day chu khong dung mot thu
    // vien: chi phuc vu thong bao loi, khong dang keo them phu thuoc.
    private static string Human(long bytes) =>
        bytes >= 1024L * 1024 * 1024 ? $"{bytes / 1024.0 / 1024 / 1024:0.##} GB"
        : bytes >= 1024L * 1024 ? $"{bytes / 1024.0 / 1024:0.#} MB"
        : bytes >= 1024 ? $"{bytes / 1024.0:0} KB"
        : $"{bytes} B";

    private static long? GetUserId(ClaimsPrincipal principal)
    {
        var sub = principal.FindFirstValue("sub");
        return sub is not null && long.TryParse(sub, out var id) ? id : null;
    }
}
