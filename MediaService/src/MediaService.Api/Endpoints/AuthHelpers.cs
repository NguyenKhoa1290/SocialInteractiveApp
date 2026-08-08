using System.Security.Claims;

namespace MediaService.Api.Endpoints;

public static class AuthHelpers
{
    public static long? GetUserId(this ClaimsPrincipal principal)
    {
        var sub = principal.FindFirstValue("sub");
        return sub is not null && long.TryParse(sub, out var id) ? id : null;
    }

    public static string GetNickname(this ClaimsPrincipal principal) =>
        principal.FindFirstValue("nickname") ?? "user";
}
