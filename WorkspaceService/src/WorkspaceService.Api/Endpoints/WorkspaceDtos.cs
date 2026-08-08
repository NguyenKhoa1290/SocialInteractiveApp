using WorkspaceService.Api.Models;

namespace WorkspaceService.Api.Endpoints;

public record CreateWorkspaceRequest(string Name, string? AvatarUrl);
public record UpdateWorkspaceRequest(string? Name, string? AvatarUrl);
public record AddMemberRequest(long UserId);
public record UpdateRoleRequest(string Role);

public record WorkspaceResponse(
    long Id, string Name, string? AvatarUrl, long CreatedBy,
    DateTimeOffset CreatedAt, DateTimeOffset UpdatedAt, List<long> MemberIds)
{
    public static WorkspaceResponse FromEntity(Workspace w) => new(
        w.Id, w.Name, w.AvatarUrl, w.CreatedBy, w.CreatedAt, w.UpdatedAt,
        w.Members.Select(m => m.UserId).ToList());
}

public record WorkspaceMemberResponse(long UserId, string Nickname, string Role, DateTimeOffset JoinedAt);

public record ErrorResponse(string Error, string Message);
