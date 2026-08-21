using System.Security.Claims;
using IdentityService.Api.Data;
using IdentityService.Api.Services;
using Microsoft.EntityFrameworkCore;

namespace IdentityService.Api.Endpoints;

public record UnreadCountResponse(int Count);

// Man hinh thong bao doc du lieu qua day; con duong day realtime la
// NotificationHub. Ca hai tra ve CUNG mot hinh dang NotificationDto de client
// chi phai xu ly mot kieu du lieu.
public static class NotificationsEndpoints
{
    public static void MapNotificationsEndpoints(this WebApplication app)
    {
        var group = app.MapGroup("/notifications").RequireAuthorization();

        // Danh sach thong bao cua CHINH MINH. Khong co duong nao doc thong bao
        // cua nguoi khac - userId luon lay tu JWT, khong nhan tu query.
        group.MapGet("", async (ClaimsPrincipal principal, IdentityDbContext db, bool? unreadOnly, int? limit) =>
        {
            var userId = GetUserId(principal)!.Value;
            var take = Math.Clamp(limit ?? 50, 1, 200);

            var query = db.Notifications.Where(n => n.UserId == userId);
            if (unreadOnly == true)
                query = query.Where(n => !n.IsRead);

            var items = await query
                .OrderByDescending(n => n.CreatedAt)
                .Take(take)
                .Select(n => NotificationDto.FromEntity(n))
                .ToListAsync();

            return Results.Ok(items);
        });

        // Tach rieng khoi endpoint tren: chuong bao chi can con so, goi moi lan
        // mo app - keo ve ca danh sach chi de dem la lang phi.
        group.MapGet("/unread-count", async (ClaimsPrincipal principal, IdentityDbContext db) =>
        {
            var userId = GetUserId(principal)!.Value;
            var count = await db.Notifications.CountAsync(n => n.UserId == userId && !n.IsRead);
            return Results.Ok(new UnreadCountResponse(count));
        });

        group.MapPost("/{notificationId:long}/read", async (long notificationId, ClaimsPrincipal principal, IdentityDbContext db) =>
        {
            var userId = GetUserId(principal)!.Value;
            var notification = await db.Notifications
                .SingleOrDefaultAsync(n => n.Id == notificationId && n.UserId == userId);
            if (notification is null)
                return Results.NotFound();

            if (!notification.IsRead)
            {
                notification.IsRead = true;
                await db.SaveChangesAsync();
            }
            return Results.NoContent();
        });

        group.MapPost("/read-all", async (ClaimsPrincipal principal, IdentityDbContext db) =>
        {
            var userId = GetUserId(principal)!.Value;
            await db.Notifications
                .Where(n => n.UserId == userId && !n.IsRead)
                .ExecuteUpdateAsync(s => s.SetProperty(n => n.IsRead, true));
            return Results.NoContent();
        });

        // Nguoi dung tu don man hinh thong bao cua minh. Xoa han chu khong an:
        // thong bao la du lieu dung mot lan, giu lai khong de lam gi.
        group.MapDelete("/{notificationId:long}", async (long notificationId, ClaimsPrincipal principal, IdentityDbContext db) =>
        {
            var userId = GetUserId(principal)!.Value;
            var deleted = await db.Notifications
                .Where(n => n.Id == notificationId && n.UserId == userId)
                .ExecuteDeleteAsync();
            return deleted == 0 ? Results.NotFound() : Results.NoContent();
        });
    }

    private static long? GetUserId(ClaimsPrincipal principal)
    {
        var raw = principal.FindFirstValue("sub");
        return long.TryParse(raw, out var id) ? id : null;
    }
}
