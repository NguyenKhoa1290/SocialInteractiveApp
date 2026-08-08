namespace MediaService.Api.Models;

public enum MeetingStatus
{
    Active,
    Ended,
}

public class Meeting
{
    public long Id { get; set; }
    public long HostId { get; set; }
    public long? WorkspaceId { get; set; }
    public long? ConversationId { get; set; }
    public MeetingStatus Status { get; set; } = MeetingStatus.Active;
    public int MaxParticipants { get; set; } = 100;
    public DateTimeOffset CreatedAt { get; set; }
    public DateTimeOffset? EndedAt { get; set; }

    public List<MeetingParticipant> Participants { get; set; } = [];
}
