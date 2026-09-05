using System.Text.Json;
using StackExchange.Redis;

namespace IdentityService.Api.Services;

// Mot lan dang ky DANG CHO xac thuc email. Chua co gi trong Postgres - toan
// bo nam o day cho toi khi nguoi dung nhap dung ma.
//
// Luu MAT KHAU DA HASH chu khong phai mat khau goc: Redis khong ma hoa o
// tang luu tru, va mot ban dump Redis khong duoc phep lam lo mat khau cua ai.
public record PendingRegistration(string Email, string PasswordHash, string Nickname, string Otp);

// Luu OTP (quen mat khau, UC-05) va session/logout blocklist trong Redis.
// Theo ghi chu trong tai lieu roadmap muc 3.2: "Ma OTP de xuat luu trong Redis
// voi TTL ngan (5-10 phut), khong can them bang Postgres".
public class RedisAuthStore(IConnectionMultiplexer redis)
{
    private readonly IDatabase _db = redis.GetDatabase();

    private static string OtpKey(string email) => $"otp:{email}";
    private static string PendingRegKey(string email) => $"pending-reg:{email.ToLowerInvariant()}";
    private static string PendingRegTryKey(string email) => $"pending-reg-try:{email.ToLowerInvariant()}";
    private static string ResendKey(string email) => $"pending-reg-resend:{email.ToLowerInvariant()}";
    private static string ResetTokenKey(string token) => $"reset-token:{token}";
    private static string LogoutKey(string jti) => $"logout:{jti}";

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
}
