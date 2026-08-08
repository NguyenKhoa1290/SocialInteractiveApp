namespace MediaService.Api.Models;

public enum InviteType
{
    Link,
    Direct,
}

public class MeetingInvite
{
    public long Id { get; set; }
    public long MeetingId { get; set; }
    public string InviteToken { get; set; } = string.Empty;
    public InviteType InviteType { get; set; } = InviteType.Link;
    public long CreatedBy { get; set; }
    public long? InvitedUserId { get; set; }
    public DateTimeOffset? ExpiresAt { get; set; }
    public DateTimeOffset CreatedAt { get; set; }
}
