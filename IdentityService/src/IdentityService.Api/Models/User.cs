namespace IdentityService.Api.Models;

public enum UserType
{
    Guest,
    Registered
}

public enum UserStatus
{
    Active,
    Locked
}

public class User
{
    public long Id { get; set; }
    public UserType UserType { get; set; }
    public string Nickname { get; set; } = string.Empty;
    public string? Email { get; set; }
    public string? PasswordHash { get; set; }
    public UserStatus Status { get; set; } = UserStatus.Active;
    public bool IsAdmin { get; set; }

    // Anh dai dien. Luu thang trong DB - xem ghi chu o identity-db-init.sql.
    // AvatarBytes chi duoc nap khi that su can (endpoint tra anh); moi cho
    // khac chi doc AvatarUpdatedAt de biet "co anh hay khong".
    public byte[]? AvatarBytes { get; set; }
    public string? AvatarMime { get; set; }
    public DateTimeOffset? AvatarUpdatedAt { get; set; }

    public DateTimeOffset CreatedAt { get; set; }
    public DateTimeOffset LastActiveAt { get; set; }

    public List<OAuthLink> OAuthLinks { get; set; } = [];
}
