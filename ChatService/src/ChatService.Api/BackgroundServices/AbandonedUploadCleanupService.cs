using ChatService.Api.Data;
using ChatService.Api.Endpoints;
using ChatService.Api.Services;
using Microsoft.EntityFrameworkCore;

namespace ChatService.Api.BackgroundServices;

// Don nhung lan tai len KHONG BAO GIO HOAN TAT.
//
// VAN DE: hang `files` duoc tao o POST /files/upload-url, TRUOC khi client
// thuc su tai len - va trigger trg_files_insert_sync_storage cong ngay
// storage_used_bytes. Do la CO Y: phai giu cho truoc, neu khong hai nguoi
// tai cung luc se cung vuot qua duoc phep kiem han muc.
//
// Nhung cho da giu thi phai co luc TRA LAI. Truoc day khong co: nguoi dung
// tai do rồi tai lai trang (hoac mat mang, hoac dong tab) thi hang do nam
// lai vinh vien, dung luong bi tru vinh vien, va cac phan da tai len nam
// trong MinIO khong ai don.
//
// Da thay that trong CSDL san xuat: mot nhom bi tinh 1.811.419.196 byte cho
// DUNG MOT file 864MB - dung gap doi, vi lan tai dut giua chung cung duoc
// cong. Kem theo 3 lan tai nhieu phan do dang trong MinIO, hai trong so do
// thuoc hoi thoai da bi xoa tu lau.
//
// KHI NAO COI LA BO CUOC: khi URL da ky HET HAN. Qua moc do thi khong ai co
// the tai tiep duoc nua, nen giu lai cung vo nghia. Han do co gian theo kich
// thuoc file (xem StorageService.PresignExpiryFor) - file nho vai phut, file
// rat lon toi 6 tieng - nen dung dung cong thuc do thay vi mot con so chung,
// tranh don nham mot lan tai 900MB dang chay dở.
public class AbandonedUploadCleanupService(
    IServiceScopeFactory scopeFactory,
    StorageService storage,
    ILogger<AbandonedUploadCleanupService> logger) : BackgroundService
{
    private static readonly TimeSpan Interval = TimeSpan.FromMinutes(10);

    // Cong them vao han presign truoc khi ket luan bo cuoc. Phong dong ho
    // lech va nhung giay cuoi cung cua mot lan tai vua kip.
    private static readonly TimeSpan Grace = TimeSpan.FromMinutes(15);

    protected override async Task ExecuteAsync(CancellationToken ct)
    {
        await Task.Delay(TimeSpan.FromMinutes(1), ct);

        while (!ct.IsCancellationRequested)
        {
            try
            {
                await SweepAsync(ct);
            }
            catch (OperationCanceledException) when (ct.IsCancellationRequested)
            {
                break;
            }
            catch (Exception ex)
            {
                logger.LogError(ex, "Vong don tai len do dang that bai");
            }

            try { await Task.Delay(Interval, ct); }
            catch (OperationCanceledException) { break; }
        }
    }

    private async Task SweepAsync(CancellationToken ct)
    {
        using var scope = scopeFactory.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<ChatDbContext>();

        // message_id IS NULL = chua bao gio duoc gan vao tin nhan nao. Mot
        // file da gui thi luon co message_id; thieu no nghia la nguoi dung
        // xin URL roi khong bao gio hoan tat.
        var pending = await db.Files
            .Where(f => f.MessageId == null)
            .ToListAsync(ct);

        var now = DateTimeOffset.UtcNow;
        var cleaned = 0;
        var touchedConversations = new HashSet<long>();

        foreach (var file in pending)
        {
            var deadline = file.UploadedAt
                .AddSeconds(storage.PresignExpiryFor(file.SizeBytes))
                .Add(Grace);
            if (now < deadline) continue; // van con co hoi hoan tat

            var (id, provider, key, size, conversationId, uploadId) =
                (file.Id, file.StorageProvider, file.ObjectKey, file.SizeBytes, file.ConversationId, file.UploadId);

            // Xoa hang TRUOC - trigger tu tra lai storage_used_bytes. Cung
            // thu tu voi ReleaseFileAsync: hong buoc kho luu tru thi chi con
            // file mo coi, con ke toan van dung.
            db.Files.Remove(file);
            await db.SaveChangesAsync(ct);

            try
            {
                // File lon di duong nhieu phan: object chinh chua bao gio ton
                // tai, cai an dia la cac PHAN da tai len - phai huy DICH DANH
                // bang uploadId da luu.
                if (uploadId is not null)
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

            cleaned++;
            touchedConversations.Add(conversationId);
            logger.LogInformation(
                "Don lan tai len bo do: file {FileId} ({Size} byte) cua hoi thoai {ConversationId}",
                id, size, conversationId);
        }

        // Tra dung luong xong ma nhom van khoa thi cung nhu khong.
        foreach (var conversationId in touchedConversations)
            await ConversationEndpoints.UnlockIfUnderQuotaAsync(db, conversationId, logger);

        if (cleaned > 0)
            logger.LogInformation("Da don {Count} lan tai len bo do", cleaned);

        await SweepOrphanMultipartsAsync(ct);
    }

    // Luot quet thu hai: multipart do dang KHONG con hang `files` nao tro toi.
    //
    // Luot tren di theo hang trong CSDL nen khong the thay chung. Chung sinh
    // ra khi hoi thoai bi xoa giua chung (cascade xoa hang files, con phan da
    // tai len thi o lai), hoac tu nhung lan hong truoc khi co doan sua nay.
    // Thay that: hoi thoai 29 va 38 khong con trong DB nhung multipart van
    // con.
    //
    // Nguong 24 gio: dai hon han presign toi da (6 gio) mot khoang rong, nen
    // khong the huy nham mot lan tai len dang thuc su chay.
    private async Task SweepOrphanMultipartsAsync(CancellationToken ct)
    {
        var cutoff = DateTime.UtcNow.AddHours(-24);
        foreach (var provider in storage.ProviderNames)
        {
            try
            {
                var aborted = await storage.AbortIncompleteUploadsAsync(provider, prefix: "", cutoff, ct);
                if (aborted > 0)
                    logger.LogInformation(
                        "Da huy {Count} lan tai len nhieu phan mo coi (qua 24 gio) o kho {Provider}",
                        aborted, provider);
            }
            catch (Exception ex)
            {
                logger.LogWarning(ex, "Khong quet duoc multipart mo coi o kho {Provider}", provider);
            }
        }
    }
}
