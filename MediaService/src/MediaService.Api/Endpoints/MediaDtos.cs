using MediaService.Api.Models;

namespace MediaService.Api.Endpoints;

public record ErrorResponse(string Error, string Message);

public record CreateMeetingRequest(string Mode, long? ConversationId);

public record MeetingResponse(long Id, long HostId, string Status, int MaxParticipants, DateTimeOffset CreatedAt)
{
    public static MeetingResponse FromEntity(Meeting m) => new(
        m.Id, m.HostId, m.Status == MeetingStatus.Active ? "active" : "ended", m.MaxParticipants, m.CreatedAt);
}

// Mo rong so voi schema "Meeting" trong OpenAPI spec goc - CAN mo rong vi
// tai lieu goc mo ta luong "poll GET /meetings/{meetingId}" de biet ket qua
// duyet nhung KHONG dinh nghia GET /meetings/{meetingId} tra ve gi khac
// nhau cho nguoi goi (xem WaitingRoomStore.cs). callerStatus/livekitToken
// chi co y nghia cho CHINH nguoi dang goi, khong phai thuoc tinh chung cua
// cuoc hop.
public record MeetingWithCallerStatusResponse(
    long Id, long HostId, string Status, int MaxParticipants, DateTimeOffset CreatedAt,
    string CallerStatus, string? LivekitToken, string? LivekitUrl)
{
    public static MeetingWithCallerStatusResponse From(
        Meeting m, string callerStatus, string? livekitToken, string? livekitUrl) => new(
        m.Id, m.HostId, m.Status == MeetingStatus.Active ? "active" : "ended", m.MaxParticipants, m.CreatedAt,
        callerStatus, livekitToken, livekitUrl);
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

public record GrantPermissionRequest(string PermissionType);

public record CreateChannelListRequest(string Name);

public record IptvChannelListResponse(long Id, string Name, DateTimeOffset CreatedAt)
{
    public static IptvChannelListResponse FromEntity(IptvChannelList l) => new(l.Id, l.Name, l.CreatedAt);
}

public record CreateChannelGroupRequest(string GroupName);

public record CreateChannelRequest(string ChannelName, string StreamUrl, string? AudioTrack);

public record MiniAppStartRequest(string? AppId);

public record StreamUrlResponse(string StreamUrl, string? AudioTrack);
