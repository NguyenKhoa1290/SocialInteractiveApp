using IdentityService.Api.Data;
using IdentityService.Api.Hubs;
using IdentityService.Api.Models;
using Microsoft.AspNetCore.SignalR;

namespace IdentityService.Api.Services;

// Hinh dang tra ve cho Frontend (REST lan WebSocket dung CHUNG mot kieu -
// client xu ly mot dang du lieu duy nhat du thong bao den tu duong nao).
public record NotificationDto(long Id, string Type, string Title, string? Body, string? Link, bool IsRead, DateTimeOffset CreatedAt)
{
    public static NotificationDto FromEntity(Notification n) =>
        new(n.Id, n.Type, n.Title, n.Body, n.Link, n.IsRead, n.CreatedAt);
}

// Tao thong bao + day realtime. Moi duong sinh thong bao (consumer RabbitMQ,
// khoa tai khoan do spam...) deu di qua day de khong noi nao quen buoc day
// WebSocket.
public class NotificationService(
    IdentityDbContext db,
    IHubContext<NotificationHub> hub,
    ILogger<NotificationService> logger)
{
    public async Task CreateAsync(long userId, string type, string title, string? body = null, string? link = null)
    {
        var notification = new Notification
        {
            UserId = userId,
            Type = type,
            Title = title,
            Body = body,
            Link = link,
            IsRead = false,
            CreatedAt = DateTimeOffset.UtcNow,
        };

        db.Notifications.Add(notification);
        try
        {
            await db.SaveChangesAsync();
        }
        catch (Exception ex)
        {
            // Thuong la user da bi xoa giua chung (FK ON DELETE CASCADE) -
            // khong dang de lam hong ca message dang xu ly.
            logger.LogWarning(ex, "Khong luu duoc thong bao cho user {UserId}", userId);
            return;
        }

        try
        {
            await hub.Clients.Group(NotificationHub.GroupName(userId))
                .SendAsync("NotificationReceived", NotificationDto.FromEntity(notification));
        }
        catch (Exception ex)
        {
            // Day realtime that bai KHONG duoc phep lam mat thong bao: no da
            // nam trong CSDL roi, nguoi dung se thay khi mo lai man hinh.
            logger.LogWarning(ex, "Khong day duoc thong bao realtime toi user {UserId}", userId);
        }
    }

    // Nhieu nguoi nhan cung mot su kien (vd canh bao dung luong nhom). Tao
    // tuan tu chu khong Task.WhenAll: DbContext cua EF Core KHONG an toan khi
    // dung song song tren nhieu luong.
    public async Task CreateManyAsync(IEnumerable<long> userIds, string type, string title, string? body = null, string? link = null)
    {
        foreach (var userId in userIds.Distinct())
            await CreateAsync(userId, type, title, body, link);
    }
}
