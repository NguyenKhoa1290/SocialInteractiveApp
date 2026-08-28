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

    // Claim "role" chi duoc Identity Service gan khi User.IsAdmin = true (xem
    // JwtTokenService.cs). Doc THANG ten claim chu khong dung IsInRole: o day
    // MapInboundClaims = false nen khong co anh xa ten claim mac dinh, va
    // RoleClaimType khong duoc cau hinh - IsInRole se luon tra false.
    public static bool IsAdmin(this ClaimsPrincipal principal) =>
        principal.FindFirstValue("role") == "admin";
}
