using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using StackExchange.Redis;

namespace IdentityService.Api.Services;

// Mot lan dang ky DANG CHO xac thuc email. Chua co gi trong Postgres - toan
// bo nam o day cho toi khi nguoi dung nhap dung ma.
//
// Luu MAT KHAU DA HASH chu khong phai mat khau goc: Redis khong ma hoa o
// tang luu tru, va mot ban dump Redis khong duoc phep lam lo mat khau cua ai.
public record PendingRegistration(string Email, string PasswordHash, string DisplayName, string Otp);
public record GuestCreationPermit(bool Allowed, int RetryAfterSeconds, string? ReservationId);

// Luu OTP (quen mat khau, UC-05) va session/logout blocklist trong Redis.
// Theo ghi chu trong tai lieu roadmap muc 3.2: "Ma OTP de xuat luu trong Redis
// voi TTL ngan (5-10 phut), khong can them bang Postgres".
public class RedisAuthStore(IConnectionMultiplexer redis)
{
    private readonly IDatabase _db = redis.GetDatabase();

    private const int GioiHanGuest = 3;
    private static readonly TimeSpan CuaSoGuest = TimeSpan.FromMinutes(30);
    // Mot tai khoan chi can cap nhat last_active_at toi da mot lan / 5 phut.
    // Redis khoa ca cac tab dang mo song song, tranh ghi CSDL theo tung su kien UI.
    private static readonly TimeSpan KhoangCapNhatHoatDong = TimeSpan.FromMinutes(5);

    // Phai kiem tra va ghi ca cookie device lẫn fingerprint trong MOT script:
    // tach thanh ZCARD -> ZADD o C# se tao race condition, nhieu request dong
    // thoi co the cung thay count=2 va cung tao Guest thu tu 4.
    private const string GiuChoTaoGuestScript = """
        local now = tonumber(ARGV[1])
        local window = tonumber(ARGV[2])
        local limit = tonumber(ARGV[3])
        local reservation = ARGV[4]
        local cutoff = now - window
        local blocked = false
        local retry = 0

        for i, key in ipairs(KEYS) do
          redis.call('ZREMRANGEBYSCORE', key, '-inf', cutoff)
          local count = redis.call('ZCARD', key)
          if count >= limit then
            blocked = true
            local oldest = redis.call('ZRANGE', key, 0, 0, 'WITHSCORES')
            if oldest[2] then
              local seconds = math.ceil((tonumber(oldest[2]) + window - now) / 1000)
              if seconds > retry then retry = seconds end
            end
            redis.call('PEXPIRE', key, window)
          end
        end

        if blocked then
          if retry < 1 then retry = 1 end
          return { 0, retry }
        end

        for i, key in ipairs(KEYS) do
          redis.call('ZADD', key, now, reservation)
          redis.call('PEXPIRE', key, window)
        end
        return { 1, 0 }
        """;

    private static string OtpKey(string email) => $"otp:{email}";
    private static string PendingRegKey(string email) => $"pending-reg:{email.ToLowerInvariant()}";
    private static string PendingRegTryKey(string email) => $"pending-reg-try:{email.ToLowerInvariant()}";
    private static string ResendKey(string email) => $"pending-reg-resend:{email.ToLowerInvariant()}";
    private static string ResetTokenKey(string token) => $"reset-token:{token}";
    private static string LogoutKey(string jti) => $"logout:{jti}";
    private static string UserActivityKey(long userId) => $"user-activity:{userId}";
    private static string GuestDeviceKey(string value) => $"guest-create:device:{HashKeyMaterial(value)}";
    private static string GuestFingerprintKey(string value) => $"guest-create:fingerprint:{HashKeyMaterial(value)}";

    // Khong luu cookie device hay fingerprint da gui trong Redis. SHA-256 nay
    // chi de tao khoa Redis mot chieu va TTL cua key la dung 30 phut.
    private static string HashKeyMaterial(string value)
        => Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(value))).ToLowerInvariant();

    public async Task StoreOtpAsync(string email, string otp, TimeSpan ttl)
        => await _db.StringSetAsync(OtpKey(email), otp, ttl);

    public async Task<bool> VerifyAndConsumeOtpAsync(string email, string otp)
    {
        var stored = await _db.StringGetAsync(OtpKey(email));
        if (stored.IsNullOrEmpty || stored != otp)
            return false;

        await _db.KeyDeleteAsync(OtpKey(email));
        return true;
    }

    // ---- Dang ky dang cho xac thuc email -----------------------------------

    public async Task StorePendingRegistrationAsync(PendingRegistration pending, TimeSpan ttl)
    {
        await _db.StringSetAsync(PendingRegKey(pending.Email), JsonSerializer.Serialize(pending), ttl);
        // Dem so lan nhap sai di kem, cung TTL: het han thi ca hai bien mat.
        await _db.KeyDeleteAsync(PendingRegTryKey(pending.Email));
    }

    public async Task<PendingRegistration?> GetPendingRegistrationAsync(string email)
    {
        var raw = await _db.StringGetAsync(PendingRegKey(email));
        // Ep ve string: RedisValue co ca hai phep chuyen ngam (string va byte[])
        // nen goi thang vao Deserialize la trinh bien dich khong biet chon cai nao.
        return raw.IsNullOrEmpty ? null : JsonSerializer.Deserialize<PendingRegistration>(raw.ToString());
    }

    public async Task DeletePendingRegistrationAsync(string email)
    {
        await _db.KeyDeleteAsync(PendingRegKey(email));
        await _db.KeyDeleteAsync(PendingRegTryKey(email));
    }

    // Dem so lan nhap sai. Qua nguong thi xoa han lan dang ky do - ma 6 so chi
    // co mot trieu kha nang, khong chan thi do dung duoc.
    public async Task<long> DemLanSaiAsync(string email, TimeSpan ttl)
    {
        var key = PendingRegTryKey(email);
        var lan = await _db.StringIncrementAsync(key);
        if (lan == 1)
            await _db.KeyExpireAsync(key, ttl);
        return lan;
    }

    // Chong bam "Gui lai ma" lien tuc: chi cho mot lan moi `khoang`. Tra ve
    // false khi con trong thoi gian cho.
    public async Task<bool> DuocGuiLaiAsync(string email, TimeSpan khoang)
        => await _db.StringSetAsync(ResendKey(email), "1", khoang, When.NotExists);

    public async Task<string> IssueResetTokenAsync(string email, TimeSpan ttl)
    {
        var token = Guid.NewGuid().ToString("N");
        await _db.StringSetAsync(ResetTokenKey(token), email, ttl);
        return token;
    }

    public async Task<string?> ConsumeResetTokenAsync(string token)
    {
        var email = await _db.StringGetAsync(ResetTokenKey(token));
        if (email.IsNullOrEmpty)
            return null;

        await _db.KeyDeleteAsync(ResetTokenKey(token));
        return email.ToString();
    }

    // Logout blocklist: JWT stateless nen khong "huy" duoc truc tiep - danh dau
    // jti vao blocklist toi khi token het han tu nhien, moi request sau kiem tra
    // blocklist nay (xem Program.cs, OnTokenValidated).
    public async Task BlocklistTokenAsync(string jti, TimeSpan ttl)
        => await _db.StringSetAsync(LogoutKey(jti), "1", ttl);

    public async Task<bool> IsBlocklistedAsync(string jti)
        => await _db.KeyExistsAsync(LogoutKey(jti));

    // SET NX la atomic: nhieu tab hay request dong thoi cung chi co mot request
    // duoc phep ghi timestamp thuc su vao Postgres trong cua so nay.
    public async Task<bool> DuocCapNhatHoatDongAsync(long userId)
        => await _db.StringSetAsync(UserActivityKey(userId), "1", KhoangCapNhatHoatDong, When.NotExists);

    // Tra ve mot reservation de neu ghi Postgres that bai, caller co the go no
    // khoi hai ZSET. Khi thanh cong, reservation tu het han sau 30 phut va
    // chinh la mot luot tao Guest da duoc dem.
    public async Task<GuestCreationPermit> GiuChoTaoGuestAsync(string deviceId, string? fingerprint)
    {
        var keys = fingerprint is null
            ? new RedisKey[] { GuestDeviceKey(deviceId) }
            : new RedisKey[] { GuestDeviceKey(deviceId), GuestFingerprintKey(fingerprint) };
        var reservationId = Guid.NewGuid().ToString("N");
        var now = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();

        var raw = await _db.ScriptEvaluateAsync(
            GiuChoTaoGuestScript,
            keys,
            new RedisValue[] { now, (long)CuaSoGuest.TotalMilliseconds, GioiHanGuest, reservationId });
        var result = (RedisResult[]?)raw
            ?? throw new InvalidOperationException("Redis khong tra ket qua cho gioi han tao Guest");
        if (result.Length != 2)
            throw new InvalidOperationException("Redis tra ket qua gioi han tao Guest khong hop le");
        var allowed = (long)result[0] == 1;
        var retryAfter = (int)(long)result[1];
        return new GuestCreationPermit(allowed, retryAfter, allowed ? reservationId : null);
    }

    public async Task HuyGiuChoTaoGuestAsync(string deviceId, string? fingerprint, string reservationId)
    {
        var removals = new List<Task>
        {
            _db.SortedSetRemoveAsync(GuestDeviceKey(deviceId), reservationId),
        };
        if (fingerprint is not null)
            removals.Add(_db.SortedSetRemoveAsync(GuestFingerprintKey(fingerprint), reservationId));
        await Task.WhenAll(removals);
    }
}
