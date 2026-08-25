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
// KHI NAO COI LA BO CUOC - hai moc, uu tien cai thu nhat:
//
// 1. NHIP DAP TAT (HeartbeatTimeout). Client bao "van dang chay" 15 giay mot
//    lan trong suot lan tai len (POST /files/{id}/heartbeat). Nhip tat nghia
//    la trang da dong, da F5, mat mang, hoac may sap nguon - tra lai dung
//    luong sau vai phut chu khong doi het han URL.
//
// 2. URL DA KY HET HAN - duong lui cho hang co last_heartbeat_at NULL, tuc
//    client doi cu chua biet gui nhip dap. Qua moc do thi khong ai co the
//    tai tiep duoc nua nen giu lai cung vo nghia. Han co gian theo kich
//    thuoc file (StorageService.PresignExpiryFor) - file nho vai phut, file
//    rat lon toi 6 tieng.
//
// VI SAO CAN CA HAI: khong the coi "NULL" la "da chet". Mot tab mo tu truoc
// khi trien khai ban nay van dang tai binh thuong ma khong he gui nhip dap
// nao; giet no la lam hong mot viec dang chay dung. Nen NULL di duong cu -
// cham nhung an toan - con client moi thi duoc don nhanh.
//
// Do that truoc khi sua: mot tep 905.709.598 byte bi bo do luc F5 giu nguyen
// 0,84GB han muc cua nhom trong 43,8 phut (28,8 phut han URL + 15 phut du).
public class AbandonedUploadCleanupService(
    IServiceScopeFactory scopeFactory,
    StorageService storage,
    ILogger<AbandonedUploadCleanupService> logger) : BackgroundService
{
    // Moi phut, khong phai moi 10 phut: gio da co nhip dap nen ket luan
    // den nhanh, vong quet cham lai thi bang thua. Cau truy van ben duoi chi
    // dung toi cac hang chua gan tin nhan (idx_files_pending) nen re.
    private static readonly TimeSpan Interval = TimeSpan.FromMinutes(1);

    // Bao lau khong co nhip dap thi coi la da chet.
    //
    // Client dap 15 giay mot lan -> 3 phut la bo qua duoc 11 nhip lien tiep.
    // Rong rai co chu dich: nhip dap co the im that lau ma lan tai len VAN
    // SONG - dang doi giua hai lan thu lai mot phan hong, hoac mot phan dang
    // chay rat cham (da do duoc mot phan 5MB chay 148 giay). Bat qua 3 phut
    // thi tram cham nhat cung da co nhip.
    private static readonly TimeSpan HeartbeatTimeout = TimeSpan.FromMinutes(3);

    // Cong them vao han presign truoc khi ket luan bo cuoc (duong lui cho
    // hang khong co nhip dap). Phong dong ho lech va nhung giay cuoi cung
    // cua mot lan tai vua kip.
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

        foreach (var file in pending)
        {
            // Co nhip dap thi tin nhip dap: no noi ve HIEN TAI, con han
            // presign chi la mot du doan dat ra tu luc bat dau.
            var deadline = file.LastHeartbeatAt is { } beat
                ? beat.Add(HeartbeatTimeout)
                : file.UploadedAt
                    .AddSeconds(storage.PresignExpiryFor(file.SizeBytes))
                    .Add(Grace);
            if (now < deadline) continue; // van con co hoi hoan tat

            var (id, size, conversationId) = (file.Id, file.SizeBytes, file.ConversationId);
            var byHeartbeat = file.LastHeartbeatAt is not null;

            // Cung mot loi voi luc nguoi dung tu bam huy - xem
            // FileEndpoints.ReleasePendingAsync.
            await FileEndpoints.ReleasePendingAsync(db, storage, logger, file, null, ct);

            cleaned++;
            logger.LogInformation(
                "Don lan tai len bo do: file {FileId} ({Size} byte) cua hoi thoai {ConversationId} ({LyDo})",
                id, size, conversationId, byHeartbeat ? "tat nhip dap" : "het han URL");
        }

        if (cleaned > 0)
            logger.LogInformation("Da don {Count} lan tai len bo do", cleaned);

        await SweepOrphanMultipartsAsync(db, ct);
    }

    // Luot quet thu hai: multipart do dang KHONG con hang `files` nao tro toi.
    //
    // Luot tren di theo hang trong CSDL nen khong the thay chung. Chung sinh
    // ra khi hoi thoai bi xoa giua chung (cascade xoa hang files, con phan da
    // tai len thi o lai), hoac tu nhung lan hong truoc khi co doan sua nay.
    // Thay that: hoi thoai 29 va 38 khong con trong DB nhung multipart van
    // con.
    //
    // TIEU CHI LA "KHONG CON HANG NAO", KHONG PHAI "QUA BAO LAU".
    //
    // Ban truoc loc theo thoi gian khoi tao va do that thi khong an. Thay vi
    // dao tim vi sao, bo han cach do: hang `files` LUON duoc tao TRUOC khi
    // khoi tao multipart (xem FileEndpoints), nen mot object key khong con
    // hang nao chi co the nghia la hang do da bi xoa - tuc lan tai len do
    // chac chan da chet. Khong dinh dang gi toi dong ho nen khong the huy
    // nham mot lan dang chay.
    private async Task SweepOrphanMultipartsAsync(ChatDbContext db, CancellationToken ct)
    {
        var known = (await db.Files.Select(f => f.ObjectKey).ToListAsync(ct))
            .ToHashSet(StringComparer.Ordinal);

        foreach (var provider in storage.ProviderNames)
        {
            try
            {
                var listed = await storage.ListIncompleteUploadsAsync(provider, "", ct);
                var aborted = 0;

                foreach (var (key, uploadId) in listed)
                {
                    if (known.Contains(key)) continue; // van con hang - de yen
                    try
                    {
                        await storage.AbortMultipartAsync(provider, key, uploadId, ct);
                        aborted++;
                    }
                    catch (Exception ex)
                    {
                        logger.LogWarning(ex, "Khong huy duoc multipart mo coi {Key}", key);
                    }
                }

                if (listed.Count > 0)
                    logger.LogInformation(
                        "Quet multipart o kho {Provider}: thay {Found}, huy {Aborted} cai mo coi",
                        provider, listed.Count, aborted);
            }
            catch (Exception ex)
            {
                logger.LogWarning(ex, "Khong quet duoc multipart mo coi o kho {Provider}", provider);
            }
        }
    }
}
