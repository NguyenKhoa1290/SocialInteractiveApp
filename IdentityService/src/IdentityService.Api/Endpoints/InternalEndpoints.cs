using IdentityService.Api.Data;
using IdentityService.Api.Models;
using Microsoft.EntityFrameworkCore;

namespace IdentityService.Api.Endpoints;

public record UserPublicInfo(long Id, string Nickname, string UserType)
{
    public static UserPublicInfo FromEntity(User u) => new(
        u.Id, u.Nickname, u.UserType == Models.UserType.Guest ? "guest" : "registered");
}

// Dung boi Admin Service (GET /admin/users, GET /admin/users/{id}) - day du
// hon UserPublicInfo vi can ca email/status/thoi gian cho man hinh quan tri.
public record AdminUserInfo(
    long Id, string UserType, string Nickname, string? Email, string Status,
    bool IsAdmin, DateTimeOffset CreatedAt, DateTimeOffset LastActiveAt)
{
    public static AdminUserInfo FromEntity(User u) => new(
        u.Id,
        u.UserType == Models.UserType.Guest ? "guest" : "registered",
        u.Nickname,
        u.Email,
        u.Status == UserStatus.Locked ? "locked" : "active",
        u.IsAdmin,
        u.CreatedAt,
        u.LastActiveAt);
}

public record PaginatedAdminUsers(List<AdminUserInfo> Items, int Total, int Page, int PageSize);

// KHONG di qua API Gateway public - dung boi WorkSpace/Chat/Media Service de
// resolve thong tin user (lien ket logic cross-DB), va Admin Service de go khoa.
public static class InternalEndpoints
{
    public static void MapInternalEndpoints(this WebApplication app)
    {
        var internalGroup = app.MapGroup("/internal/users");

        internalGroup.MapGet("/{userId:long}", async (long userId, IdentityDbContext db) =>
        {
            var user = await db.Users.FindAsync(userId);
            return user is null ? Results.NotFound() : Results.Ok(UserPublicInfo.FromEntity(user));
        });

        // Batch resolve, tranh N+1 khi 1 service can hien thi danh sach nhieu user
        internalGroup.MapGet("/", async (string ids, IdentityDbContext db) =>
        {
            var parsedIds = ids.Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries)
                .Select(s => long.TryParse(s, out var id) ? id : (long?)null)
                .Where(id => id.HasValue)
                .Select(id => id!.Value)
                .ToList();

            var found = await db.Users.Where(u => parsedIds.Contains(u.Id)).ToListAsync();
            return Results.Ok(found.Select(UserPublicInfo.FromEntity));
        });

        // Go khoa tai khoan - dong bo, do Admin chu dong thuc hien (UC-12 nhanh 3a)
        internalGroup.MapPost("/{userId:long}/unlock", async (long userId, IdentityDbContext db) =>
        {
            var user = await db.Users.FindAsync(userId);
            if (user is null)
                return Results.NotFound();

            user.Status = UserStatus.Active;
            await db.SaveChangesAsync();
            return Results.Ok(UserResponse.FromEntity(user));
        });

        // Chi tiet 1 user (day du hon UserPublicInfo) - dung boi Admin Service
        // (GET /admin/users/{userId}).
        internalGroup.MapGet("/{userId:long}/admin-detail", async (long userId, IdentityDbContext db) =>
        {
            var user = await db.Users.FindAsync(userId);
            return user is null ? Results.NotFound() : Results.Ok(AdminUserInfo.FromEntity(user));
        });

        // Danh sach toan bo user co phan trang/tim kiem - dung boi Admin Service
        // (GET /admin/users). Tim theo nickname (ILIKE) hoac email (ILIKE).
        internalGroup.MapGet("/admin-list", async (int? page, int? pageSize, string? search, IdentityDbContext db) =>
        {
            var p = page.GetValueOrDefault(1) < 1 ? 1 : page!.Value;
            var ps = pageSize.GetValueOrDefault(20) is < 1 or > 100 ? 20 : pageSize!.Value;

            var query = db.Users.AsQueryable();
            if (!string.IsNullOrWhiteSpace(search))
                query = query.Where(u => EF.Functions.ILike(u.Nickname, $"%{search}%")
                    || (u.Email != null && EF.Functions.ILike(u.Email, $"%{search}%")));

            var total = await query.CountAsync();
            var items = await query
                .OrderBy(u => u.Id)
                .Skip((p - 1) * ps)
                .Take(ps)
                .ToListAsync();

            return Results.Ok(new PaginatedAdminUsers(items.Select(AdminUserInfo.FromEntity).ToList(), total, p, ps));
        });

        // Cap quyen admin - thao tac boostrap thu cong (khong co UI/luong dang
        // ky Admin trong tai lieu goc). Chi goi noi bo/CLI, KHONG public.
        internalGroup.MapPost("/{userId:long}/promote-admin", async (long userId, IdentityDbContext db) =>
        {
            var user = await db.Users.FindAsync(userId);
            if (user is null)
                return Results.NotFound();

            user.IsAdmin = true;
            await db.SaveChangesAsync();
            return Results.Ok(AdminUserInfo.FromEntity(user));
        });
    }
}
