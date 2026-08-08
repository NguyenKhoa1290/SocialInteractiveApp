namespace WorkspaceService.Api.Models;

public enum MemberRole
{
    Leader,
    Deputy,
    Member
}

public class WorkspaceMember
{
    public long Id { get; set; }
    public long WorkspaceId { get; set; }
    public long UserId { get; set; }
    public MemberRole Role { get; set; } = MemberRole.Member;
    public long? InvitedBy { get; set; }
    public DateTimeOffset JoinedAt { get; set; }

    public Workspace? Workspace { get; set; }

    public static string RoleToString(MemberRole role) => role switch
    {
        MemberRole.Leader => "leader",
        MemberRole.Deputy => "deputy",
        _ => "member",
    };

    public static MemberRole RoleFromString(string role) => role switch
    {
        "leader" => MemberRole.Leader,
        "deputy" => MemberRole.Deputy,
        _ => MemberRole.Member,
    };
}
