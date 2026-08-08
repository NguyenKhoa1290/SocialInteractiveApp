using System.Security.Claims;
using IdentityService.Api.Data;
using Microsoft.EntityFrameworkCore;

namespace IdentityService.Api.Endpoints;

public static class UsersEndpoints
{
    public static void MapUsersEndpoints(this WebApplication app)
    {
        var users = app.MapGroup("/users").RequireAuthorization();

        users.MapGet("/me", async (ClaimsPrincipal principal, IdentityDbContext db) =>
        {
            var userId = GetUserId(principal);
            if (userId is null)
                return Results.Unauthorized();

            var user = await db.Users.FindAsync(userId.Value);
            return user is null ? Results.NotFound() : Results.Ok(UserResponse.FromEntity(user));
        });

        // Bat buoc goi sau dang ky/dang nhap OAuth lan dau (requiresNickname=true),
        // co the goi lai bat ky luc nao de doi ten hien thi.
        users.MapPatch("/me/nickname", async (UpdateNicknameRequest req, ClaimsPrincipal principal, IdentityDbContext db) =>
        {
            if (string.IsNullOrWhiteSpace(req.Nickname) || req.Nickname.Length > 50)
                return Results.BadRequest(new ErrorResponse("invalid_request", "Nickname bat buoc, toi da 50 ky tu"));

            var userId = GetUserId(principal);
            if (userId is null)
                return Results.Unauthorized();

            var user = await db.Users.FindAsync(userId.Value);
            if (user is null)
                return Results.NotFound();

            user.Nickname = req.Nickname;
            await db.SaveChangesAsync();
            return Results.Ok(UserResponse.FromEntity(user));
        });
    }

    private static long? GetUserId(ClaimsPrincipal principal)
    {
        var sub = principal.FindFirstValue("sub");
        return sub is not null && long.TryParse(sub, out var id) ? id : null;
    }
}
