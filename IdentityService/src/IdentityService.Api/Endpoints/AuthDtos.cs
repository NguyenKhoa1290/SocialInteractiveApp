using IdentityService.Api.Models;

namespace IdentityService.Api.Endpoints;

public record RegisterRequest(string Email, string Password, string Nickname);
public record LoginRequest(string Email, string Password);
public record GuestRequest(string Nickname);

public record UserResponse(long Id, string UserType, string Nickname, string? Email, string Status, DateTimeOffset CreatedAt)
{
    public static UserResponse FromEntity(User u) => new(
        u.Id,
        u.UserType == Models.UserType.Guest ? "guest" : "registered",
        u.Nickname,
        u.Email,
        u.Status == UserStatus.Active ? "active" : "locked",
        u.CreatedAt);
}

public record AuthSuccessResponse(string AccessToken, UserResponse User);
public record ErrorResponse(string Error, string Message);
