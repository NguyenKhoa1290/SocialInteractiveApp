using ChatService.Api.Data;
using ChatService.Api.Services;
using Microsoft.EntityFrameworkCore;

namespace ChatService.Api.BackgroundServices;

public class StorageWarningOptions
{
    public int CheckIntervalMinutes { get; set; } = 60;
}

// Chuoi canh bao truoc khi xoa file: con 3 ngay -> 2 ngay -> 1 ngay -> 10
// tieng, dung theo mo ta tai lieu roadmap muc 6.1. Nguong/thu tu duoc dac ta
// trong tai lieu, nhung CO CHE THEO DOI da gui canh bao o moc nao
// (last_warning_stage) va HANH DONG xoa file cu the KHONG duoc dac ta chi
// tiet - la trien khai tu de xuat.
public class StorageWarningService(
    IServiceScopeFactory scopeFactory,
    StorageWarningOptions options,
    ILogger<StorageWarningService> logger) : BackgroundService
{
    // Thu tu tu xa toi gan - dung de xac dinh moc canh bao hien tai dua tren
    // thoi gian con lai toi storage_expires_at.
    private static readonly (TimeSpan Remaining, string Stage)[] Stages =
    [
        (TimeSpan.FromDays(3), "3d"),
        (TimeSpan.FromDays(2), "2d"),
        (TimeSpan.FromDays(1), "1d"),
        (TimeSpan.FromHours(10), "10h"),
    ];

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        while (!stoppingToken.IsCancellationRequested)
        {
            try
            {
                await CheckLockedGroupsAsync(stoppingToken);
            }
            catch (Exception ex)
            {
                logger.LogError(ex, "Loi khi chay StorageWarningService");
            }

            await Task.Delay(TimeSpan.FromMinutes(options.CheckIntervalMinutes), stoppingToken);
        }
    }

    private async Task CheckLockedGroupsAsync(CancellationToken ct)
    {
        using var scope = scopeFactory.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<ChatDbContext>();
        var publisher = scope.ServiceProvider.GetRequiredService<StorageWarningPublisher>();
        var workspaceClient = scope.ServiceProvider.GetRequiredService<WorkspaceClient>();

        var lockedGroups = await db.GroupChatSettings
            .Where(g => g.IsLocked && g.StorageExpiresAt != null)
            .ToListAsync(ct);

        foreach (var settings in lockedGroups)
        {
            var remaining = settings.StorageExpiresAt!.Value - DateTimeOffset.UtcNow;

            if (remaining <= TimeSpan.Zero)
            {
                await DeleteOldestFilesUntilUnderQuotaAsync(db, settings.ConversationId, ct);
                settings.IsLocked = false;
                settings.StorageExpiresAt = null;
                settings.LastWarningStage = null;
                settings.UpdatedAt = DateTimeOffset.UtcNow;
                await db.SaveChangesAsync(ct);
                logger.LogWarning("Da xoa bot file cu do het han canh bao, mo khoa lai group conversation {ConversationId}", settings.ConversationId);
                continue;
            }

            var currentStage = Stages.FirstOrDefault(s => remaining <= s.Remaining);
            if (currentStage.Stage is null || currentStage.Stage == settings.LastWarningStage)
                continue;

            var conversation = await db.Conversations.FindAsync([settings.ConversationId], ct);
            if (conversation?.WorkspaceId is null)
                continue;

            // Bao cho CA NHOM chu khong rieng Truong nhom: file cua moi nguoi
            // deu se bi xoa. Chi Truong nhom nap them duoc, nhung nguoi khac
            // co quyen biet de con kip tai file cua minh ve.
            var members = await workspaceClient.GetMembersAsync(conversation.WorkspaceId.Value);
            var recipients = members is null ? [] : members.Select(m => m.UserId).ToList();
            await publisher.PublishAsync(conversation.WorkspaceId.Value, settings.ConversationId, currentStage.Stage, settings.StorageExpiresAt, recipients);
            settings.LastWarningStage = currentStage.Stage;
            await db.SaveChangesAsync(ct);
            logger.LogInformation("Da gui canh bao xoa file moc '{Stage}' cho group conversation {ConversationId}", currentStage.Stage, settings.ConversationId);
        }
    }

    private static async Task DeleteOldestFilesUntilUnderQuotaAsync(ChatDbContext db, long conversationId, CancellationToken ct)
    {
        var settings = await db.GroupChatSettings.FindAsync([conversationId], ct);
        if (settings is null)
            return;

        // Xoa tung file cu nhat truoc, trigger DB tu tru storage_used_bytes
        // sau moi lan xoa - dung lai khi da duoi han muc hoac het file.
        while (settings.StorageUsedBytes > settings.StorageQuotaBytes)
        {
            var oldest = await db.Files
                .Where(f => f.ConversationId == conversationId)
                .OrderBy(f => f.UploadedAt)
                .FirstOrDefaultAsync(ct);
            if (oldest is null)
                break;

            db.Files.Remove(oldest);
            await db.SaveChangesAsync(ct);
            await db.Entry(settings).ReloadAsync(ct);
        }
    }
}
