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

    // Phong tuy chinh: ConversationId tro toi mot hoi thoai TAM do chinh cuoc
    // hop nay so huu, va se bi xoa han khi hop ket thuc. Voi cuoc hop mo tu
    // nhom thi co nay = false va ConversationId la hoi thoai THAT cua nhom -
    // tuyet doi khong duoc dong vao.
    public bool IsTemporary { get; set; }

    // Bat phong cho hay khong - host doi duoc ngay trong phong.
    public bool RequiresApproval { get; set; } = true;
    public DateTimeOffset CreatedAt { get; set; }
    public DateTimeOffset? EndedAt { get; set; }

    public List<MeetingParticipant> Participants { get; set; } = [];
}
