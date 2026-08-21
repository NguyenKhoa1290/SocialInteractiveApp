using IdentityService.Api.Data;
using Microsoft.EntityFrameworkCore;

namespace IdentityService.Api.BackgroundServices;

public class NotificationCleanupOptions
{
    public int IntervalHours { get; set; } = 24;

    // Da doc thi gia tri chi con la lich su - giu mot tuan la du de nguoi
    // dung tim lai thu vua bam nham.
    public int ReadRetentionDays { get; set; } = 7;

    // Chua doc thi giu lau hon, nhung khong giu mai: mot thong bao "co tin
    // nhan moi" tu 30 ngay truoc thi bam vao cung khong con y nghia gi.
    public int UnreadRetentionDays { get; set; } = 30;
}

// Bang notifications la bang DUY NHAT trong he thong chi co duong ghi vao ma
// khong co duong xoa ra: moi tin nhan trong moi nhom deu sinh mot dong cho
// TUNG nguoi nhan. Mot nhom 20 nguoi chat 200 tin/ngay la 4.000 dong moi
// ngay - de lau thi no lon hon ca bang tin nhan that.
//
// Nguoi dung co the tu xoa tung cai, nhung khong the trong cho ho don.
//
// Cung mau voi GuestCleanupService va P2PCleanupService: mot vong lap don
// gian moi 24 gio, khong dung thu vien lap lich nao.
public class NotificationCleanupService(
    IServiceScopeFactory scopeFactory,
    NotificationCleanupOptions options,
    ILogger<NotificationCleanupService> logger) : BackgroundService
{
    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        while (!stoppingToken.IsCancellationRequested)
        {
            try
            {
                await CleanupAsync(stoppingToken);
            }
            catch (Exception ex)
            {
                // Don dep that bai khong duoc phep lam chet service - lan sau
                // don bu.
                logger.LogError(ex, "Loi khi don thong bao cu");
            }

            try
            {
                await Task.Delay(TimeSpan.FromHours(options.IntervalHours), stoppingToken);
            }
            catch (OperationCanceledException)
            {
                return;
            }
        }
    }

    private async Task CleanupAsync(CancellationToken ct)
    {
        using var scope = scopeFactory.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<IdentityDbContext>();

        var now = DateTimeOffset.UtcNow;
        var readCutoff = now.AddDays(-options.ReadRetentionDays);
        var unreadCutoff = now.AddDays(-options.UnreadRetentionDays);

        // ExecuteDeleteAsync chay thang mot cau DELETE duoi CSDL, khong keo
        // ban ghi len bo nho roi xoa tung cai - quan trong vi day co the la
        // hang chuc nghin dong.
        var deletedRead = await db.Notifications
            .Where(n => n.IsRead && n.CreatedAt < readCutoff)
            .ExecuteDeleteAsync(ct);

        var deletedOld = await db.Notifications
            .Where(n => n.CreatedAt < unreadCutoff)
            .ExecuteDeleteAsync(ct);

        if (deletedRead + deletedOld > 0)
            logger.LogInformation(
                "Da don {Read} thong bao da doc qua {ReadDays} ngay va {Old} thong bao qua {OldDays} ngay",
                deletedRead, options.ReadRetentionDays, deletedOld, options.UnreadRetentionDays);
    }
}
