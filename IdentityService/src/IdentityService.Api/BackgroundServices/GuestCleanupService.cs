using IdentityService.Api.Data;
using IdentityService.Api.Models;
using Microsoft.EntityFrameworkCore;

namespace IdentityService.Api.BackgroundServices;

public class GuestCleanupOptions
{
    public int IntervalHours { get; set; } = 24;
    public int ExpiryMonths { get; set; } = 6;
}

// Scheduled job noi bo (khong qua message queue) - xoa vinh vien Guest khong
// hoat dong lien tuc qua ExpiryMonths thang, dung theo mo ta UC-04/muc 3.1
// tai lieu roadmap. Quet bang idx_users_last_active (index rieng cho truong
// hop nay, xem identity-db-init.sql).
public class GuestCleanupService(
    IServiceScopeFactory scopeFactory,
    GuestCleanupOptions options,
    ILogger<GuestCleanupService> logger) : BackgroundService
{
    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        while (!stoppingToken.IsCancellationRequested)
        {
            try
            {
                await CleanupExpiredGuestsAsync(stoppingToken);
            }
            catch (Exception ex)
            {
                logger.LogError(ex, "Loi khi chay GuestCleanupService");
            }

            await Task.Delay(TimeSpan.FromHours(options.IntervalHours), stoppingToken);
        }
    }

    private async Task CleanupExpiredGuestsAsync(CancellationToken ct)
    {
        using var scope = scopeFactory.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<IdentityDbContext>();

        var cutoff = DateTimeOffset.UtcNow.AddMonths(-options.ExpiryMonths);
        var expired = await db.Users
            .Where(u => u.UserType == UserType.Guest && u.LastActiveAt < cutoff)
            .ToListAsync(ct);

        if (expired.Count == 0)
            return;

        db.Users.RemoveRange(expired);
        await db.SaveChangesAsync(ct);
        logger.LogInformation("GuestCleanupService: da xoa {Count} Guest het han (khong hoat dong > {Months} thang)",
            expired.Count, options.ExpiryMonths);
    }
}
