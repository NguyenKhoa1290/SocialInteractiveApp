using MediaService.Api.Data;
using MediaService.Api.Services;
using Microsoft.EntityFrameworkCore;

namespace MediaService.Api.BackgroundServices;

// Cu 10 phut mot lan, nhap lai nhung playlist DUOC TAO TU MOT LINK M3U.
//
// Vi sao can: nguon IPTV khong dung yen. Token trong duong dan luong het han,
// CDN doi may chu, nha dai them/bot kenh. Mot playlist nhap mot lan roi de do
// thi vai ngay sau la mot nua so kenh khong phat duoc, ma nguoi dung khong co
// cach nao biet ngoai viec bam vao tung kenh.
//
// Chi dong vao playlist co source_url. Playlist go tay thi khong co link nguon
// nen khong bao gio bi cham toi.
public sealed class PlaylistRefreshService(
    IServiceProvider services,
    ILogger<PlaylistRefreshService> logger) : BackgroundService
{
    private static readonly TimeSpan Nhip = TimeSpan.FromMinutes(10);

    // Doi mot chut truoc vong dau: luc pod vua len con dang chay migration va
    // nhan request dau tien, khong nen tranh tai nguyen voi chung.
    private static readonly TimeSpan ChoDau = TimeSpan.FromMinutes(1);

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        try
        {
            await Task.Delay(ChoDau, stoppingToken);
        }
        catch (OperationCanceledException)
        {
            return;
        }

        while (!stoppingToken.IsCancellationRequested)
        {
            try
            {
                await MotVongAsync(stoppingToken);
            }
            catch (Exception ex)
            {
                // MOT playlist hong khong duoc lam chet ca vong lap - lan sau
                // van phai chay.
                logger.LogWarning(ex, "Vong lam moi playlist hong");
            }

            try
            {
                await Task.Delay(Nhip, stoppingToken);
            }
            catch (OperationCanceledException)
            {
                return;
            }
        }
    }

    private async Task MotVongAsync(CancellationToken ct)
    {
        using var scope = services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<MiniAppDbContext>();
        var importer = scope.ServiceProvider.GetRequiredService<PlaylistImporter>();

        var danhSach = await db.IptvChannelLists
            .Where(l => l.SourceUrl != null)
            .ToListAsync(ct);

        foreach (var list in danhSach)
        {
            if (ct.IsCancellationRequested) return;
            try
            {
                var kq = await importer.NhapAsync(db, list, list.SourceUrl!, list.AutoGroups, ct);
                if (!kq.LaPlaylist)
                {
                    // Nguon chet hoac doi thanh mot luong don - ghi lai roi di
                    // tiep, KHONG go source_url: mang co the chi hong mot luc.
                    logger.LogInformation(
                        "Playlist {Id} khong nhap lai duoc: {Loi}", list.Id, kq.Loi ?? "khong phai playlist");
                    continue;
                }

                if (kq.Them > 0 || kq.CapNhat > 0 || kq.Xoa > 0 || kq.NhomMoi > 0)
                {
                    logger.LogInformation(
                        "Playlist {Id}: them {Them} kenh, doi link {CapNhat}, go {Xoa} kenh da bien mat, {Nhom} nhom moi",
                        list.Id, kq.Them, kq.CapNhat, kq.Xoa, kq.NhomMoi);
                }
            }
            catch (Exception ex)
            {
                logger.LogWarning(ex, "Khong lam moi duoc playlist {Id}", list.Id);
            }
        }
    }
}
