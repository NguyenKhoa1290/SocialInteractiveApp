using System.Text.Json;
using StackExchange.Redis;

namespace MediaService.Api.Services;

// Kind: screen (chia se man hinh) hoac mini_app (IPTV...).
//
// CO Y KHONG co kind "ghim nguoi vao giua": ghim la LUA CHON XEM RIENG cua
// tung nguoi, xu ly hoan toan o Frontend, khong gui len server va khong ap
// cho ai khac. Chi nhung thu THUC SU dung chung (man hinh dang chia se, mini
// app dang mo) moi can trang thai o server.
// ChannelId/ChannelName chi co nghia voi Kind = "mini_app": day la kenh MA
// CA PHONG dang xem. Truoc day moi client tu chon kenh trong component cua
// rieng no, nen "ca phong cung xem mot kenh" khong bao gio that su xay ra -
// va doi bo cuc mot cai la mat luon lua chon. Dat o day thi no di theo
// duong phat san co (Redis + metadata phong LiveKit) toi moi nguoi.
//
// NULL nghia la nguoi trinh bay da mo Mini App nhung chua chon kenh - client
// khac hien "Dang cho gan link kenh".
// ChannelId va ChannelUrl la HAI DUONG song song toi cung mot cho:
//   ChannelId  - kenh lay tu danh sach da luu (moi may tu goi
//                /mini-app/iptv/stream-url de doi ra URL).
//   ChannelUrl - link nguoi trinh bay dan thang vao, khong luu vao danh
//                sach nao. URL di luon trong trang thai nay nen khong can
//                mot vong goi API nua.
// Chi mot trong hai co gia tri tai mot thoi diem; ChannelUrl duoc uu tien.
public record PresentationState(
    long UserId, string Nickname, string Kind, string? AppId, DateTimeOffset StartedAt,
    long? ChannelId = null, string? ChannelName = null, string? ChannelUrl = null);

// Hinh dang metadata phong LiveKit: {"presentation": {...}} hoac {} khi
// khong ai trinh bay. Giu dang object long nhau de sau nay them truong khac
// vao metadata phong ma khong pha vo client cu.
public record RoomMetadata(PresentationState? Presentation);

// Nguon su that cho "ai dang trinh bay", thay cho metadata cua phong LiveKit.
//
// VI SAO DOI: metadata LiveKit nam ben kia Internet. Do that tren he thong
// dang chay: MOI loi goi LiveKit Cloud tu server nha ton ~1250 ms (RTT ~200ms
// + bat tay TLS moi lan ~500ms). Endpoint "bat dau trinh bay" goi HAI lan
// (doc xem ai dang trinh bay, roi ghi) -> hon 3 giay moi lan bam nut chia se
// man hinh hay mo mini app. CPU nhan hoan toan - toan bo thoi gian la ngoi
// cho mang.
//
// Redis nam trong cum, mot lan doc/ghi duoi 1 ms.
//
// LOI THEM, khong chi nhanh: cach cu la check-then-act tren hai loi goi mang
// tach roi - hai nguoi bam cung luc thi ca hai deu doc thay "chua ai trinh
// bay" roi cung ghi, nguoi ghi sau de len nguoi ghi truoc. Redis SET NX la
// mot thao tac nguyen tu, dung mot nguoi thang.
//
// Metadata LiveKit VAN duoc ghi (xem PresentationEndpoints) nhung khong con
// chan duong tra loi - no chi con dong vai tro kenh phat cho nguoi dang o
// trong phong va cho nguoi vao muon doc duoc trang thai luc ket noi.
public class PresentationStore(IConnectionMultiplexer redis)
{
    private readonly IDatabase _db = redis.GetDatabase();

    // Dai hon token vao phong (6 gio) de mot cuoc hop dai khong bi mat trang
    // thai giua chung. Ket thuc hop thi xoa han - xem ClearAsync.
    private static readonly TimeSpan Ttl = TimeSpan.FromHours(12);

    private static string Key(long meetingId) => $"meeting:{meetingId}:presentation";

    public async Task<PresentationState?> GetAsync(long meetingId)
    {
        var raw = await _db.StringGetAsync(Key(meetingId));
        return raw.IsNullOrEmpty ? null : JsonSerializer.Deserialize<PresentationState>((string)raw!);
    }

    // Tra ve null neu gianh duoc suat, hoac trang thai cua NGUOI DANG TRINH
    // BAY neu suat da co chu.
    //
    // Nguoi dang trinh bay tu bam lai KHONG bi chan: do la doi noi dung (vd
    // tu chia se man hinh sang mini app), khong phai tranh suat.
    public async Task<PresentationState?> TryClaimAsync(long meetingId, PresentationState state)
    {
        var key = Key(meetingId);
        var json = JsonSerializer.Serialize(state);

        if (await _db.StringSetAsync(key, json, Ttl, When.NotExists))
            return null;

        var current = await GetAsync(meetingId);
        if (current is not null && current.UserId != state.UserId)
            return current;

        // Suat cua chinh minh (hoac vua het han giua chung) - ghi de.
        await _db.StringSetAsync(key, json, Ttl);
        return null;
    }

    // Tra ve true neu that su co gi do de xoa. Chi nguoi dang trinh bay hoac
    // Chu phong duoc goi - noi goi tu kiem tra quyen.
    public Task<bool> ClearAsync(long meetingId) => _db.KeyDeleteAsync(Key(meetingId));
}
