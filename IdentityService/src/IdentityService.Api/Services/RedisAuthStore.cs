using StackExchange.Redis;

namespace IdentityService.Api.Services;

// Luu OTP (quen mat khau, UC-05) va session/logout blocklist trong Redis.
// Theo ghi chu trong tai lieu roadmap muc 3.2: "Ma OTP de xuat luu trong Redis
// voi TTL ngan (5-10 phut), khong can them bang Postgres".
public class RedisAuthStore(IConnectionMultiplexer redis)
{
    private readonly IDatabase _db = redis.GetDatabase();

    private static string OtpKey(string email) => $"otp:{email}";
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
