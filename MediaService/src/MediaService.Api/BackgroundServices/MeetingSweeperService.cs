using MediaService.Api.Data;
using MediaService.Api.Models;
using MediaService.Api.Services;
using Microsoft.EntityFrameworkCore;

namespace MediaService.Api.BackgroundServices;

// Dong nhung cuoc hop khong con ai nhung trong CSDL van ghi "dang dien ra".
//
// VAN DE truoc day: viec don dep di NHO mot endpoint phuc vu muc dich khac -
// GET /meetings/active?conversationId=X. Ba lo hong tu do:
//
//  1. Cuoc hop chi duoc dong KHI CO NGUOI MO DUNG PHONG CHAT do. Khong ai mo
//     thi no "dang dien ra" vo thoi han, va phong chat hien banner "Dang co
//     cuoc hop" cho mot cuoc hop khong con ai.
//  2. Cuoc hop DOC LAP (mode=standalone, conversation_id NULL) khong bao gio
//     lot vao truy van do, nen KHONG CO duong nao ket thuc duoc chung.
//  3. GET /meetings/{id} - chinh cai ma trang phong hop poll - khong he kiem
//     tra, nen ngoi trong mot cuoc hop da chet thi khong gi sua duoc no.
//
// Ba lo hong deu cung mot goc: khong co ai CHIU TRACH NHIEM don dep. Day la
// cho do.
//
// Vi sao dua vao day ma khong sua tung endpoint: don dep la viec dinh ky
// theo thoi gian, khong phai viec phat sinh tu mot request nao. Gan vao
// request thi luon con mot duong nao do khong ai di qua.
//
// NGUON SU THAT van la LiveKit: phong rong duoc LiveKit tu xoa sau
// EmptyTimeout (300 giay, xem LiveKitService.CreateRoomAsync). Phong khong
// con = cuoc hop that su da tan, du DB con ghi gi.
public class MeetingSweeperService(
    IServiceScopeFactory scopeFactory,
    LiveKitService liveKit,
    WaitingRoomStore waiting,
    PresentationStore presentation,
    RoomLivenessCache liveness,
    ILogger<MeetingSweeperService> logger) : BackgroundService
{
    private static readonly TimeSpan Interval = TimeSpan.FromMinutes(1);

    // Cuoc hop moi tao chua xet toi. LiveKit cung dung EmptyTimeout 300 giay
    // cho ca truong hop "tao xong khong ai vao", nen truoc moc do khong the
    // ket luan gi; va neu CreateRoom that bai luc tao thi cho them vai phut
    // cung khong hai gi.
    private static readonly TimeSpan MinAge = TimeSpan.FromMinutes(6);

    protected override async Task ExecuteAsync(CancellationToken ct)
    {
        // Lech nhip khoi luc khoi dong - dung don het viec nang vao dung giay
        // service vua len, luc no con dang mo ket noi CSDL/Redis.
        await Task.Delay(TimeSpan.FromSeconds(30), ct);

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
                // Mot vong quet hong khong duoc phep giet ca vong lap - lan
                // sau thu lai.
                logger.LogError(ex, "Vong quet cuoc hop that bai");
            }

            try { await Task.Delay(Interval, ct); }
            catch (OperationCanceledException) { break; }
        }
    }

    private async Task SweepAsync(CancellationToken ct)
    {
        using var scope = scopeFactory.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<MediaDbContext>();

        var cutoff = DateTimeOffset.UtcNow - MinAge;
        var candidates = await db.Meetings
            .Where(m => m.Status == MeetingStatus.Active && m.CreatedAt < cutoff)
            .ToListAsync(ct);

        if (candidates.Count == 0)
            return;

        var alive = await liveKit.ListExistingRoomsAsync([.. candidates.Select(m => m.Id)]);
        if (alive is null)
        {
            // Khong hoi duoc LiveKit. Bo qua ca vong - khong bao gio duoc
            // suy "khong hoi duoc" thanh "khong con phong nao".
            logger.LogWarning("Bo qua vong quet: khong hoi duoc LiveKit");
            return;
        }

        var dead = candidates.Where(m => !alive.Contains(m.Id)).ToList();
        if (dead.Count == 0)
            return;

        var now = DateTimeOffset.UtcNow;
        var deadIds = dead.Select(m => m.Id).ToList();

        // Doi qua entity chu khong ExecuteUpdate: cot status co value
        // converter (enum <-> chuoi 'active'/'ended'), di duong entity thi
        // chac chan bo chuyen doi duoc ap dung.
        foreach (var m in dead)
        {
            m.Status = MeetingStatus.Ended;
            m.EndedAt = now;
        }
        await db.SaveChangesAsync(ct);

        // Dong ca cac hang participant. Chay SAU khi cuoc hop da chuyen sang
        // "ended" nen trigger trg_close_meeting_if_empty thanh vo hai (no chi
        // dong cuoc hop dang o trang thai active).
        await db.MeetingParticipants
            .Where(p => deadIds.Contains(p.MeetingId) && p.LeftAt == null)
            .ExecuteUpdateAsync(s => s.SetProperty(p => p.LeftAt, now), ct);

        foreach (var id in deadIds)
        {
            await waiting.ClearMeetingAsync(id);
            // Trang thai trinh bay co TTL 12 gio - khong xoa thi nguoi mo hop
            // sau tuong con ai dang trinh bay.
            await presentation.ClearAsync(id);
            await liveness.ClearAsync(id);
        }

        logger.LogInformation(
            "Da dong {Count} cuoc hop khong con ai (phong LiveKit da tan): {Ids}",
            deadIds.Count, string.Join(",", deadIds));
    }
}
