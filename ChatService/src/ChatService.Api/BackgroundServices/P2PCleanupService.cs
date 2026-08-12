using ChatService.Api.Data;
using ChatService.Api.Models;
using Microsoft.EntityFrameworkCore;

namespace ChatService.Api.BackgroundServices;

public class P2PCleanupOptions
{
    public int IntervalHours { get; set; } = 24;
    public int InactivityMonths { get; set; } = 6;
}

// Cron xoa vinh vien cuoc tro chuyen P2P khong hoat dong qua
// InactivityMonths thang - dung theo mo ta tai lieu roadmap muc 6.1: "Tu
// dong xoa toan bo cuoc tro chuyen neu khong hoat dong 6 thang, xoa thang
// khong canh bao, ap dung cho MOI cuoc chat P2P ke ca giua 2 Registered
// User". Xoa Conversation se cascade xoa Messages/Files/MessageRecipientKeys
// lien quan qua FK ON DELETE CASCADE (xem chat-db-init.sql).
public class P2PCleanupService(
    IServiceScopeFactory scopeFactory,
    P2PCleanupOptions options,
    ILogger<P2PCleanupService> logger) : BackgroundService
{
    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        while (!stoppingToken.IsCancellationRequested)
        {
            try
            {
                await CleanupInactiveP2PAsync(stoppingToken);
            }
            catch (Exception ex)
            {
                logger.LogError(ex, "Loi khi chay P2PCleanupService");
            }

            await Task.Delay(TimeSpan.FromHours(options.IntervalHours), stoppingToken);
        }
    }

    private async Task CleanupInactiveP2PAsync(CancellationToken ct)
    {
        using var scope = scopeFactory.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<ChatDbContext>();

        var cutoff = DateTimeOffset.UtcNow.AddMonths(-options.InactivityMonths);

        // "Khong hoat dong" = LastMessageAt < cutoff, HOAC chua tung co tin
        // nhan nao (LastMessageAt null) VA tao qua lau (CreatedAt < cutoff) -
        // tranh xoa nham cuoc tro chuyen vua tao, chua kip nhan tin dau tien.
        var expired = await db.Conversations
            .Where(c => c.Type == ConversationType.P2P)
            .Where(c => (c.LastMessageAt != null && c.LastMessageAt < cutoff)
                     || (c.LastMessageAt == null && c.CreatedAt < cutoff))
            .ToListAsync(ct);

        if (expired.Count == 0)
            return;

        db.Conversations.RemoveRange(expired);
        await db.SaveChangesAsync(ct);
        logger.LogInformation("P2PCleanupService: da xoa {Count} cuoc tro chuyen P2P khong hoat dong > {Months} thang",
            expired.Count, options.InactivityMonths);
    }
}
