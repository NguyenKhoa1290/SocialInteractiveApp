using AdminService.Api.Services;

namespace AdminService.Api.Endpoints;

public record ErrorResponse(string Error, string Message);

public record AdminUserDetail(
    long Id, string UserType, string Nickname, string? Email, string Status,
    DateTimeOffset CreatedAt, DateTimeOffset LastActiveAt, List<SpamViolation> Violations)
{
    public static AdminUserDetail FromInfo(AdminUserInfo u, List<SpamViolation> violations) => new(
        u.Id, u.UserType, u.Nickname, u.Email, u.Status, u.CreatedAt, u.LastActiveAt, violations);
}

public record PaginatedUsers(List<AdminUserInfo> Items, int Total, int Page, int PageSize);

public record ScaleRequest(int Replicas);
public record LiveKitExpandRequest(string? Reason);
public record ComplaintReplyRequest(string Message);
