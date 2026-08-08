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
    public DateTimeOffset CreatedAt { get; set; }
    public DateTimeOffset LastActiveAt { get; set; }

    public List<OAuthLink> OAuthLinks { get; set; } = [];
}
