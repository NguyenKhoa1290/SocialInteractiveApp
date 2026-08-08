namespace IdentityService.Api.Models;

public enum OAuthProvider
{
    Google,
    Facebook
}

public class OAuthLink
{
    public long Id { get; set; }
    public long UserId { get; set; }
    public OAuthProvider Provider { get; set; }
    public string ProviderUserId { get; set; } = string.Empty;
    public DateTimeOffset LinkedAt { get; set; }

    public User? User { get; set; }
}
