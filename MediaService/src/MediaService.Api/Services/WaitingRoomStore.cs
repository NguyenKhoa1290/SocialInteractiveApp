using System.Text.Json;
using StackExchange.Redis;

namespace MediaService.Api.Services;

public record WaitingEntry(long UserId, string Nickname, DateTimeOffset RequestedAt);

// UC-33 buoc 3 (phong yeu cau duyet): trang thai "dang cho duyet" la du
// lieu phien (session-scoped), khong ben vung, nen dat trong Redis - dung
// pattern giong ghi chu "session-scoped hop voi Redis hon" da neu trong tai
// lieu thiet ke muc 7.2 (Ghi chu/Diem mo) cho trang thai IPTV dang phat.
//
// Quyet dinh tu thiet ke (tai lieu goc KHONG mo ta ro co che nay): endpoint
// GET /meetings/{meetingId} khi API spec goc chi mo ta "poll hoac lang nghe
// qua WebSocket" nhung KHONG dinh nghia GET /meetings/{meetingId} tra ve gi
// khac nhau cho nguoi dang cho duyet - du an nay chua co lop WebSocket
// (chua service nao dung), nen bat buoc phai co the "poll ra ket qua" that
// su. Giai phap: luu rieng 1 key "denied" TTL ngan de nguoi bi tu choi doc
// duoc 1 lan roi tu xoa (xem MeetingsEndpoints.cs, GetMeeting).
public class WaitingRoomStore(IConnectionMultiplexer redis)
{
    private readonly IDatabase _db = redis.GetDatabase();
    private static readonly TimeSpan DeniedTtl = TimeSpan.FromMinutes(5);

    private static string WaitingKey(long meetingId) => $"meeting:{meetingId}:waiting";
    private static string DeniedKey(long meetingId, long userId) => $"meeting:{meetingId}:denied:{userId}";

    public Task AddAsync(long meetingId, long userId, string nickname) =>
        _db.HashSetAsync(WaitingKey(meetingId), userId.ToString(),
            JsonSerializer.Serialize(new WaitingEntry(userId, nickname, DateTimeOffset.UtcNow)));

    public async Task<bool> IsWaitingAsync(long meetingId, long userId) =>
        await _db.HashExistsAsync(WaitingKey(meetingId), userId.ToString());

    public async Task<List<WaitingEntry>> ListAsync(long meetingId)
    {
        var entries = await _db.HashGetAllAsync(WaitingKey(meetingId));
        return entries.Select(e => JsonSerializer.Deserialize<WaitingEntry>((string)e.Value!)!).ToList();
    }

    public Task RemoveAsync(long meetingId, long userId) =>
        _db.HashDeleteAsync(WaitingKey(meetingId), userId.ToString());

    public async Task MarkDeniedAsync(long meetingId, long userId)
    {
        await RemoveAsync(meetingId, userId);
        await _db.StringSetAsync(DeniedKey(meetingId, userId), "1", DeniedTtl);
    }

    // "Tieu thu" 1 lan - client poll thay denied=true thi dung, khong can
    // gui lai lan sau.
    public async Task<bool> ConsumeDeniedAsync(long meetingId, long userId)
    {
        var key = DeniedKey(meetingId, userId);
        var existed = await _db.KeyDeleteAsync(key);
        return existed;
    }

    public Task ClearMeetingAsync(long meetingId) => _db.KeyDeleteAsync(WaitingKey(meetingId));
}
