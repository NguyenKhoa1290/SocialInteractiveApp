using AdminService.Api.Services;

namespace AdminService.Api.Endpoints;

public record ErrorResponse(string Error, string Message);

public record AdminUserDetail(
    long Id, string UserType, string Nickname, string DisplayName, string? Email, string Status,
    DateTimeOffset CreatedAt, DateTimeOffset LastActiveAt, DateTimeOffset? GuestExpiresAt, List<SpamViolation> Violations)
{
    public static AdminUserDetail FromInfo(AdminUserInfo u, List<SpamViolation> violations) => new(
        u.Id, u.UserType, u.Nickname, u.DisplayName, u.Email, u.Status, u.CreatedAt, u.LastActiveAt, u.GuestExpiresAt, violations);
}

public record PaginatedUsers(List<AdminUserInfo> Items, int Total, int Page, int PageSize);

public record ScaleRequest(int Replicas);
public record LiveKitExpandRequest(string? Reason);
public record ComplaintReplyRequest(string Message);
