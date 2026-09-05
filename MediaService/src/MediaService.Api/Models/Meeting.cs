namespace MediaService.Api.Models;

public enum MeetingStatus
{
    Active,
    Ended,
}

public class Meeting
{
    public long Id { get; set; }

    // Chu phong HIEN TAI - khong phai nguoi mo phong, va KHONG bat bien nhu
    // tai lieu goc ghi: chu roi di ma phong con nguoi thi quyen tu chuyen
    // sang nguoi khac (HostSuccession.cs). Moi cho kiem tra quyen deu phai
    // doc lai cot nay tung request, dung nho mot lan luc vao phong.
    public long HostId { get; set; }

    // Nguoi MO phong - bat bien that su, khong bao gio doi.
    //
    // HostId chay qua chay lai khi chu roi phong va quay lai, nen phai co mot
    // cho ghi "ai moi la chu that". Dung cho ba viec: chu that quay lai thi
    // doi lai duoc quyen ngay, vao phong khong phai qua phong cho, va khong
    // ai duoi duoc ho.
    public long CreatorId { get; set; }
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

    // MAC DINH CUA CA PHONG ("Cai dat phong", Figma 140:645). Rieng tung
    // nguoi thi mot hang no_* trong meeting_permissions de bep len tren; chu
    // phong luon duoc phep. Xem ghi chu day du o media-db-init.sql.
    public bool AllowCamera { get; set; } = true;
    public bool AllowMic { get; set; } = true;
    public bool AllowScreenShare { get; set; } = true;
    public bool AllowMiniApp { get; set; }
    public DateTimeOffset CreatedAt { get; set; }
    public DateTimeOffset? EndedAt { get; set; }

    public List<MeetingParticipant> Participants { get; set; } = [];
}
