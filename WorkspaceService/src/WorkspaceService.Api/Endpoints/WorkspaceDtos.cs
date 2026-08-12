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

// Dung cho GET /workspaces (danh sach nhom cua toi) - khac WorkspaceResponse
// o cho co them MyRole (vai tro cua NGUOI GOI trong nhom do, Frontend can de
// hien badge/an nut theo quyen ma khong phai goi rieng GET /members).
public record WorkspaceSummaryResponse(long Id, string Name, string? AvatarUrl, string MyRole, DateTimeOffset UpdatedAt);

public record ErrorResponse(string Error, string Message);
