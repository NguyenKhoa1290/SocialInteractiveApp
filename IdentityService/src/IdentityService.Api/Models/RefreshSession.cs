namespace IdentityService.Api.Models;

// Mot phien dang nhap dai han gan voi mot trinh duyet/thiet bi. Cookie chi
// chua token ngau nhien; CSDL chi luu SHA-256 cua token de dump CSDL khong
// duoc phep dung de dang nhap ngay lap tuc.
public class RefreshSession
{
    public Guid Id { get; set; }
    public long UserId { get; set; }
    public string TokenHash { get; set; } = string.Empty;
    public DateTimeOffset CreatedAt { get; set; }
    public DateTimeOffset LastUsedAt { get; set; }
    public DateTimeOffset ExpiresAt { get; set; }
}
