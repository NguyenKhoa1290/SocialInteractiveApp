using WorkspaceService.Api.Models;

namespace WorkspaceService.Api.Endpoints;

public record CreateWorkspaceRequest(string Name, string? AvatarUrl);
public record UpdateWorkspaceRequest(string? Name, string? AvatarUrl);
public record AddMemberRequest(long UserId);
public record UpdateRoleRequest(string Role);

// AvatarUpdatedAt vua la co "nhom nay co anh hay chua", vua la ma chong cache
// ma Frontend gan vao duoi dia chi anh (?v=...). Khong tra byte anh o day -
// anh di duong rieng qua GET /workspaces/{id}/avatar.
public record WorkspaceResponse(
    long Id, string Name, string? AvatarUrl, DateTimeOffset? AvatarUpdatedAt, long CreatedBy,
    DateTimeOffset CreatedAt, DateTimeOffset UpdatedAt, List<long> MemberIds)
{
    public static WorkspaceResponse FromEntity(Workspace w) => new(
        w.Id, w.Name, w.AvatarUrl, w.AvatarUpdatedAt, w.CreatedBy, w.CreatedAt, w.UpdatedAt,
        w.Members.Select(m => m.UserId).ToList());
}

public record WorkspaceMemberResponse(long UserId, string Nickname, string Role, DateTimeOffset JoinedAt);

// Dung cho GET /workspaces (danh sach nhom cua toi) - khac WorkspaceResponse
// o cho co them MyRole (vai tro cua NGUOI GOI trong nhom do, Frontend can de
// hien badge/an nut theo quyen ma khong phai goi rieng GET /members).
public record WorkspaceSummaryResponse(
    long Id, string Name, string? AvatarUrl, DateTimeOffset? AvatarUpdatedAt,
    string MyRole, DateTimeOffset UpdatedAt);

// Tra ve sau khi doi/xoa anh nhom. Chi mot truong: Frontend chi can moc thoi
// gian moi de dung lai dia chi anh (?v=...) va bat trinh duyet nap ban moi.
public record WorkspaceAvatarResponse(DateTimeOffset? AvatarUpdatedAt);

public record ErrorResponse(string Error, string Message);
