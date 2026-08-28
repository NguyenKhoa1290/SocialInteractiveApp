using MediaService.Api.Models;

namespace MediaService.Api.Endpoints;

public record ErrorResponse(string Error, string Message);

public record CreateMeetingRequest(string Mode, long? ConversationId);

// Doi cau hinh phong khi dang hop - hien chi co cong tac phong cho. Dung
// nullable de sau nay them truong khac ma khong bat client phai gui lai het.
public record UpdateMeetingRequest(bool? RequiresApproval);

public record MeetingResponse(
    long Id, long HostId, long? ConversationId, string Status, int MaxParticipants, DateTimeOffset CreatedAt,
    bool IsTemporary, bool RequiresApproval)
{
    public static MeetingResponse FromEntity(Meeting m) => new(
        m.Id, m.HostId, m.ConversationId, m.Status == MeetingStatus.Active ? "active" : "ended", m.MaxParticipants, m.CreatedAt,
        m.IsTemporary, m.RequiresApproval);
}

// Mo rong so voi schema "Meeting" trong OpenAPI spec goc - CAN mo rong vi
// tai lieu goc mo ta luong "poll GET /meetings/{meetingId}" de biet ket qua
// duyet nhung KHONG dinh nghia GET /meetings/{meetingId} tra ve gi khac
// nhau cho nguoi goi (xem WaitingRoomStore.cs). callerStatus/livekitToken
// chi co y nghia cho CHINH nguoi dang goi, khong phai thuoc tinh chung cua
// cuoc hop.
public record MeetingWithCallerStatusResponse(
    long Id, long HostId, long? ConversationId, string Status, int MaxParticipants, DateTimeOffset CreatedAt,
    string CallerStatus, string? LivekitToken, string? LivekitUrl,
    bool IsTemporary, bool RequiresApproval)
{
    public static MeetingWithCallerStatusResponse From(
        Meeting m, string callerStatus, string? livekitToken, string? livekitUrl) => new(
        m.Id, m.HostId, m.ConversationId, m.Status == MeetingStatus.Active ? "active" : "ended", m.MaxParticipants, m.CreatedAt,
        callerStatus, livekitToken, livekitUrl, m.IsTemporary, m.RequiresApproval);
}

public record MeetingPreviewResponse(long MeetingId, string HostNickname, int ParticipantCount, bool RequiresApproval);

public record CreateInviteRequest(string Type, long? InvitedUserId);

public record InviteResponse(long Id, string Type, string InviteToken, DateTimeOffset? ExpiresAt)
{
    public static InviteResponse FromEntity(MeetingInvite i) => new(
        i.Id, i.InviteType == InviteType.Link ? "link" : "direct", i.InviteToken, i.ExpiresAt);
}

public record JoinMeetingRequest(string? Nickname);

public record JoinResultResponse(string Status, string? LivekitToken, string? LivekitUrl, long MeetingId);

public record WaitingParticipantResponse(long UserId, string Nickname, DateTimeOffset RequestedAt);

// Thieu sot phat hien khi build Frontend F5: co API kick/cap quyen theo
// userId nhung KHONG co cach nao liet ke ai dang o trong phong de bam.
public record MeetingParticipantResponse(
    long UserId, string Nickname, string Role, DateTimeOffset JoinedAt, string[] Permissions);

public record GrantPermissionRequest(string PermissionType);

// Shared = true chi admin goi duoc: playlist do se hien cho MOI nguoi.
public record CreateChannelListRequest(string Name, bool? Shared);

// CanEdit tinh RIENG cho nguoi dang goi - playlist dung chung thi ai cung
// thay nhung chi admin sua duoc, nen day khong phai thuoc tinh co dinh cua
// playlist ma la cau tra loi cho "toi lam gi duoc voi no".
public record IptvChannelListResponse(long Id, string Name, DateTimeOffset CreatedAt, bool IsShared, bool CanEdit)
{
    public static IptvChannelListResponse FromEntity(IptvChannelList l, bool canEdit) =>
        new(l.Id, l.Name, l.CreatedAt, l.IsShared, canEdit);
}

public record CreateChannelGroupRequest(string GroupName);

public record IptvChannelResponse(long Id, string ChannelName, string StreamUrl, string? AudioTrack);
public record IptvChannelGroupResponse(long Id, string GroupName, IptvChannelResponse[] Channels);

public record CreateChannelRequest(string ChannelName, string StreamUrl, string? AudioTrack);

// isPlaylist = false nghia la URL do la MOT luong HLS binh thuong, khong co
// gi de tach - noi goi nen bao nguoi dung them no nhu mot kenh don.
// AutoGroups = false: do het kenh vao MOT nhom mang ten playlist, thay vi
// tach theo thuoc tinh group-title. Dung khi playlist nguon chia nhom lung
// tung ma nguoi dung chi muon mot danh sach phang.
public record ImportPlaylistRequest(string Url, bool? AutoGroups);
public record ImportPlaylistResponse(bool IsPlaylist, int Imported, int Skipped, int NewGroups);

public record MiniAppStartRequest(string? AppId);

public record StreamUrlResponse(string StreamUrl, string? AudioTrack);

public record ResolveDirectRequest(string Url, string? Name);

// Verified = may chu doc duoc noi dung va xac nhan day la mot luong HLS.
// false nghia la khong kiem duoc (nguon chan/khong phan hoi voi may chu) -
// van phat, nhung bao cho nguoi trinh bay biet.
public record DirectStreamResponse(string StreamUrl, string Name, bool Verified, string? Warning);
