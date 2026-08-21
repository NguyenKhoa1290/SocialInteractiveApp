using StackExchange.Redis;

namespace MediaService.Api.Services;

// Nho lai "phong ben LiveKit con song khong" trong thoi gian ngan.
//
// VI SAO CAN: GET /meetings/active bi Frontend poll 10 giay/lan trong MOI
// phong chat dang mo, va khi co cuoc hop thi moi lan poll deu goi LiveKit
// Cloud - ton ~1250ms mot lan. Mot nhom 5 nguoi cung mo phong chat la 30 loi
// goi moi phut cho cung mot cau hoi.
//
// Cache 30 giay la du chinh xac: no chi phuc vu viec phat hien "cuoc hop da
// tan that su" (moi nguoi dong tab chu khong bam Roi phong), ma ben LiveKit
// phai 5 phut khong nguoi moi tu don phong (EmptyTimeout). Tre 30 giay so
// voi nguong 5 phut la khong dang ke.
//
// CHI cache ket qua "con song". Ket qua "da tan" khong can cache vi noi goi
// se danh dau cuoc hop ket thuc ngay, lan sau khong hoi den nua.
public class RoomLivenessCache(IConnectionMultiplexer redis)
{
    private readonly IDatabase _db = redis.GetDatabase();
    private static readonly TimeSpan Ttl = TimeSpan.FromSeconds(30);

    private static string Key(long meetingId) => $"meeting:{meetingId}:alive";

    public async Task<bool> IsAliveAsync(long meetingId, Func<Task<bool>> check)
    {
        var key = Key(meetingId);
        if (await _db.KeyExistsAsync(key))
            return true;

        var alive = await check();
        if (alive)
            await _db.StringSetAsync(key, "1", Ttl);
        return alive;
    }

    // Goi khi ket thuc hop de lan poll ngay sau do khong con doc phai ban
    // cache cu va bao "van con cuoc hop".
    public Task ClearAsync(long meetingId) => _db.KeyDeleteAsync(Key(meetingId));
}
