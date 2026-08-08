using System.Security.Claims;
using IdentityService.Api.Data;
using IdentityService.Api.Models;
using IdentityService.Api.Services;
using Microsoft.AspNetCore.Authorization;
using Microsoft.EntityFrameworkCore;

namespace IdentityService.Api.Endpoints;

public static class AuthEndpoints
{
    public static void MapAuthEndpoints(this WebApplication app)
    {
        var auth = app.MapGroup("/auth");

        // UC-06: Dang ky bang email + mat khau
        auth.MapPost("/register", async (RegisterRequest req, IdentityDbContext db, JwtTokenService jwt) =>
        {
            if (string.IsNullOrWhiteSpace(req.Email) || string.IsNullOrWhiteSpace(req.Password) || string.IsNullOrWhiteSpace(req.Nickname))
                return Results.BadRequest(new ErrorResponse("invalid_request", "Email, password va nickname la bat buoc"));

            if (req.Password.Length < 8)
                return Results.BadRequest(new ErrorResponse("weak_password", "Mat khau toi thieu 8 ky tu"));

            var exists = await db.Users.AnyAsync(u => u.Email == req.Email);
            if (exists)
                return Results.Conflict(new ErrorResponse("email_taken", "Email da duoc dang ky"));

            var user = new User
            {
                UserType = UserType.Registered,
                Nickname = req.Nickname,
                Email = req.Email,
                PasswordHash = BCrypt.Net.BCrypt.HashPassword(req.Password),
                Status = UserStatus.Active,
                CreatedAt = DateTimeOffset.UtcNow,
                LastActiveAt = DateTimeOffset.UtcNow,
            };
            db.Users.Add(user);
            await db.SaveChangesAsync();

            var token = jwt.IssueToken(user);
            return Results.Created($"/users/{user.Id}", new AuthSuccessResponse(token, UserResponse.FromEntity(user)));
        });

        // UC-01: Dang nhap email + mat khau
        auth.MapPost("/login", async (LoginRequest req, IdentityDbContext db, JwtTokenService jwt) =>
        {
            var user = await db.Users.SingleOrDefaultAsync(u => u.Email == req.Email);
            if (user is null || user.PasswordHash is null || !BCrypt.Net.BCrypt.Verify(req.Password, user.PasswordHash))
                return Results.Json(new ErrorResponse("invalid_credentials", "Sai email hoac mat khau"), statusCode: 401);

            if (user.Status == UserStatus.Locked)
                return Results.Json(
                    new { error = "account_locked", message = "Tai khoan dang bi khoa vi vi pham chinh sach chong spam" },
                    statusCode: 403);

            user.LastActiveAt = DateTimeOffset.UtcNow;
            await db.SaveChangesAsync();

            var token = jwt.IssueToken(user);
            return Results.Ok(new AuthSuccessResponse(token, UserResponse.FromEntity(user)));
        });

        // UC-04: Truy cap dang Guest - chi can nickname
        auth.MapPost("/guest", async (GuestRequest req, IdentityDbContext db, JwtTokenService jwt) =>
        {
            if (string.IsNullOrWhiteSpace(req.Nickname) || req.Nickname.Length > 50)
                return Results.BadRequest(new ErrorResponse("invalid_request", "Nickname bat buoc, toi da 50 ky tu"));

            var user = new User
            {
                UserType = UserType.Guest,
                Nickname = req.Nickname,
                Status = UserStatus.Active,
                CreatedAt = DateTimeOffset.UtcNow,
                LastActiveAt = DateTimeOffset.UtcNow,
            };
            db.Users.Add(user);
            await db.SaveChangesAsync();

            var token = jwt.IssueToken(user);
            return Results.Ok(new AuthSuccessResponse(token, UserResponse.FromEntity(user)));
        });

        // GET /users/me - can JWT hop le
        app.MapGet("/users/me", async (ClaimsPrincipal principal, IdentityDbContext db) =>
        {
            var sub = principal.FindFirstValue("sub");
            if (sub is null || !long.TryParse(sub, out var userId))
                return Results.Unauthorized();

            var user = await db.Users.FindAsync(userId);
            return user is null ? Results.NotFound() : Results.Ok(UserResponse.FromEntity(user));
        }).RequireAuthorization();
    }
}
