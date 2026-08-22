using MediaService.Api.Data;
using Microsoft.EntityFrameworkCore;
using StackExchange.Redis;

namespace MediaService.Api.Services;

// Don nhung nguoi da dong tab ma khong bam "Roi phong".
//
// VAN DE: bang meeting_participants chi biet nhung gi client TU KHAI BAO -
// left_at duoc ghi o dung ba cho: bam nut Roi phong, bi chu phong moi ra, va
// cuoc hop ket thuc. Dong tab khong trung cai nao, nen hang do nam lai mai
// voi left_at = NULL. Hau qua khong chi la con so "Nguoi tham gia" sai: moi
// kiem tra quyen deu hoi dung bang nay, nen nguoi da dong tab van giu quyen
// nhan vao thao luan cuoc hop, van chiem cho trong max_participants.
//
// VI SAO KHONG BAT SU KIEN DONG TAB O FRONTEND: da tung lam, da phai go bo.
// `pagehide` khong phan biet duoc dong tab voi F5/dieu huong, nen mot cai F5
// la goi /leave -> trigger trg_close_meeting_if_empty -> KET THUC ca cuoc
// hop cua moi nguoi. Xem ghi chu trong MeetingRoomPage.tsx.
//
// CACH LAM O DAY: hoi thang LiveKit "trong phong dang co nhung ai", roi doi
// chieu. LiveKit quan sat duoc ket noi that nen no la nguon su that duy nhat
// dang tin.
//
// BA LAN CAN AN TOAN, deu de tranh lap lai dung cai loi cu (quet nham nguoi
// dang o trong phong):
//
//  1. Khong hoi duoc LiveKit -> khong ket luan gi. Mot su co tam thoi cua
//     LiveKit khong duoc phep duoi nguoi ra khoi cuoc hop that.
//  2. Phong RONG -> khong lam gi. Truong hop "moi nguoi cung dong tab" da co
//     duong tu chua rieng o GET /meetings/active (LiveKit tu xoa phong rong
//     sau EmptyTimeout). Nho vay ham nay KHONG BAO GIO lam rong bang, tuc
//     khong bao gio kich hoat trigger dong phong - dung cai bay cu.
//  3. Phai vang mat qua HAI lan quan sat cach nhau it nhat Grace. Mot lan
//     khong thay co the la dang F5 hoac dang noi lai mang.
public class ParticipantReconciler(
    IConnectionMultiplexer redis,
    LiveKitService liveKit,
    ILogger<ParticipantReconciler> logger)
{
    // Vang mat lien tuc bao lau thi coi la da roi. Phai rong hon han thoi
    // gian noi lai cua LiveKit va mot lan F5; doi lai la ten nguoi da di co
    // the con nam tren danh sach them khoang mot phut - cai gia re hon nhieu
    // so voi duoi nham nguoi dang hop.
    private static readonly TimeSpan Grace = TimeSpan.FromSeconds(60);

    // Chan tan suat goi LiveKit. Frontend poll 4 giay mot lan, phong 5 nguoi
    // la hon mot request moi giay neu khong chan.
    private static readonly TimeSpan Throttle = TimeSpan.FromSeconds(10);

    public async Task ReconcileAsync(long meetingId, long callerId, MediaDbContext db, CancellationToken ct = default)
    {
        var cache = redis.GetDatabase();

        // SET NX: nguoi dau tien den trong moi 10 giay moi thuc su di doi
        // chieu, nhung nguoi con lai di thang qua.
        if (!await cache.StringSetAsync($"meeting:{meetingId}:recon", "1", Throttle, When.NotExists))
            return;

        var live = await liveKit.ListParticipantIdsAsync(meetingId);
        if (live is null || live.Count == 0)
            return; // lan can 1 va 2

        var active = await db.MeetingParticipants
            .Where(p => p.MeetingId == meetingId && p.LeftAt == null)
            .ToListAsync(ct);

        var now = DateTimeOffset.UtcNow;
        var removed = new List<long>();

        foreach (var p in active)
        {
            var key = $"meeting:{meetingId}:absent:{p.UserId}";

            // Nguoi dang goi API nay hien nhien con o day, du LiveKit chua
            // thay ho (dang ket noi, hoac vua F5 xong).
            if (p.UserId == callerId || live.Contains(p.UserId))
            {
                await cache.KeyDeleteAsync(key);
                continue;
            }

            // Vua duoc cap token, chua kip ket noi.
            if (now - p.JoinedAt < Grace)
                continue;

            var firstMissing = await cache.StringGetAsync(key);
            if (!firstMissing.HasValue)
            {
                // Lan dau khong thay: ghi moc thoi gian roi cho vong sau
                // (lan can 3). Redis co bi xoa key thi cung chi lam cham
                // them mot vong, khong bao gio duoi nham.
                await cache.StringSetAsync(key, now.ToUnixTimeSeconds(), TimeSpan.FromHours(6));
                continue;
            }

            if (now.ToUnixTimeSeconds() - (long)firstMissing < Grace.TotalSeconds)
                continue;

            p.LeftAt = now;
            removed.Add(p.UserId);
            await cache.KeyDeleteAsync(key);
        }

        if (removed.Count == 0)
            return;

        await db.SaveChangesAsync(ct);
        logger.LogInformation(
            "Cuoc hop {MeetingId}: don {Count} nguoi da dong tab ma khong roi phong ({Users})",
            meetingId, removed.Count, string.Join(",", removed));
    }
}
