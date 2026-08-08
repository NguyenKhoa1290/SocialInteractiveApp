namespace MediaService.Api.Models;

public enum ParticipantRole
{
    Host,
    Participant,
}

public class MeetingParticipant
{
    public long Id { get; set; }
    public long MeetingId { get; set; }
    public long UserId { get; set; }
    public ParticipantRole Role { get; set; } = ParticipantRole.Participant;
    public DateTimeOffset JoinedAt { get; set; }
    public DateTimeOffset? LeftAt { get; set; }
}
