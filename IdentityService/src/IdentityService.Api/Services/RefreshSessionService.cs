using System.Security.Cryptography;
using System.Text;
using IdentityService.Api.Data;
using IdentityService.Api.Models;
using Microsoft.EntityFrameworkCore;

namespace IdentityService.Api.Services;

public class RefreshSessionOptions
{
    // Day la cua so KHONG HOAT DONG. Moi lan refresh khi dang dung app se keo
    // lai them dung so thang nay; khong phai tran thoi gian cua mot phien dang dung.
    public int IdleExpiryMonths { get; set; } = 6;
}

public sealed class RefreshSessionService(
    IdentityDbContext db,
    RefreshSessionOptions options,
    IHostEnvironment environment)
{
    private const string CookieName = "calli_refresh_session";
    private const string CookiePath = "/auth";

    public async Task IssueAsync(HttpContext http, long userId, CancellationToken cancellationToken = default)
    {
        var now = DateTimeOffset.UtcNow;
        var expiresAt = AddIdleWindow(now);
        var rawToken = CreateToken();
        db.RefreshSessions.Add(new RefreshSession
        {
            Id = Guid.NewGuid(),
            UserId = userId,
            TokenHash = Hash(rawToken),
            CreatedAt = now,
            LastUsedAt = now,
            ExpiresAt = expiresAt,
        });
        await db.SaveChangesAsync(cancellationToken);
        SetCookie(http, rawToken, expiresAt);
    }

    // Gia han token dang co thay vi xoay moi o moi request. Cookie dung chung
    // cho cac tab, nen cach nay tranh hai tab refresh dong thoi tu da nhau va
    // vo tinh dang xuat nguoi dung. Token 256-bit, HttpOnly va chi luu dang hash.
    public async Task<long?> TryExtendAsync(HttpContext http, CancellationToken cancellationToken = default)
    {
        if (!http.Request.Cookies.TryGetValue(CookieName, out var rawToken) || string.IsNullOrWhiteSpace(rawToken))
            return null;

        var now = DateTimeOffset.UtcNow;
        var expiresAt = AddIdleWindow(now);
        var tokenHash = Hash(rawToken);
        var userId = await db.RefreshSessions
            .AsNoTracking()
            .Where(s => s.TokenHash == tokenHash && s.ExpiresAt > now)
            .Select(s => (long?)s.UserId)
            .SingleOrDefaultAsync(cancellationToken);
        if (userId is null)
        {
            ClearCookie(http);
            return null;
        }

        // Dieu kien hash + expires nam ngay trong UPDATE de token vua bi thu
        // hoi hay het han giua hai truy van khong the duoc gia han tro lai.
        var updated = await db.RefreshSessions
            .Where(s => s.TokenHash == tokenHash && s.ExpiresAt > now)
            .ExecuteUpdateAsync(setters => setters
                .SetProperty(s => s.LastUsedAt, now)
                .SetProperty(s => s.ExpiresAt, expiresAt), cancellationToken);
        if (updated != 1)
        {
            ClearCookie(http);
            return null;
        }

        SetCookie(http, rawToken, expiresAt);
        return userId;
    }

    public async Task RevokeCurrentAsync(HttpContext http, CancellationToken cancellationToken = default)
    {
        if (http.Request.Cookies.TryGetValue(CookieName, out var rawToken) && !string.IsNullOrWhiteSpace(rawToken))
        {
            await db.RefreshSessions
                .Where(s => s.TokenHash == Hash(rawToken))
                .ExecuteDeleteAsync(cancellationToken);
        }
        ClearCookie(http);
    }

    public Task RevokeAllForUserAsync(long userId, CancellationToken cancellationToken = default)
        => db.RefreshSessions.Where(s => s.UserId == userId).ExecuteDeleteAsync(cancellationToken);

    private DateTimeOffset AddIdleWindow(DateTimeOffset now)
        => now.AddMonths(Math.Max(1, options.IdleExpiryMonths));

    private void SetCookie(HttpContext http, string rawToken, DateTimeOffset expiresAt)
        => http.Response.Cookies.Append(CookieName, rawToken, CookieOptions(expiresAt));

    private void ClearCookie(HttpContext http)
        => http.Response.Cookies.Delete(CookieName, CookieOptions(DateTimeOffset.UnixEpoch));

    private CookieOptions CookieOptions(DateTimeOffset expiresAt) => new()
    {
        HttpOnly = true,
        Secure = !environment.IsDevelopment(),
        SameSite = SameSiteMode.Lax,
        Path = CookiePath,
        Expires = expiresAt,
        IsEssential = true,
    };

    private static string CreateToken()
        => Convert.ToBase64String(RandomNumberGenerator.GetBytes(32))
            .TrimEnd('=').Replace('+', '-').Replace('/', '_');

    private static string Hash(string token)
        => Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(token))).ToLowerInvariant();
}
