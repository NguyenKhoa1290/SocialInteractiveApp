using System.Text;
using System.Text.Json;
using IdentityService.Api.Data;
using IdentityService.Api.Models;
using Microsoft.EntityFrameworkCore;
using RabbitMQ.Client;
using RabbitMQ.Client.Events;

namespace IdentityService.Api.BackgroundServices;

public class RabbitMqOptions
{
    public string HostName { get; set; } = "localhost";
    public int Port { get; set; } = 5672;
    public string Username { get; set; } = "guest";
    public string Password { get; set; } = "guest";
    public string AccountLockedQueue { get; set; } = "identity.account-locked";
    public string DeleteAccountSpamQueue { get; set; } = "identity.delete-account-spam";
}

// Format PHAI khop voi SpamTrackingService
// (SpamTrackingService/src/SpamTrackingService.Api/Services/RabbitMqPublisher.cs)
// - da xac nhan thuc te khop khi SpamTrackingService duoc xay dung o Phase 3.
public record AccountLockedMessage(long UserId, string Reason);
public record DeleteAccountSpamMessage(long UserId, string Reason);

// Consume 2 su kien tu SpamTrackingService qua RabbitMQ (dung chung 1
// connection/channel): "Khoa tai khoan" -> set status=locked; "Delete
// Account Spam" -> xoa vinh vien (xoa hang trong bang users). Dung theo mo
// ta tai lieu roadmap muc 3.1 va 8.1.
public class AccountLockedConsumerService(
    IServiceScopeFactory scopeFactory,
    RabbitMqOptions options,
    ILogger<AccountLockedConsumerService> logger) : BackgroundService
{
    private IConnection? _connection;
    private IChannel? _channel;

    // RabbitMQ chua san sang luc service khoi dong la chuyen BINH THUONG:
    // ca cum cung bat mot luc (docker compose up, may vua khoi dong lai) thi
    // broker gan nhu chac chan len sau. Truoc day ExecuteAsync goi thang
    // CreateConnectionAsync, loi thoat ra ngoai -> .NET mac dinh
    // BackgroundServiceExceptionBehavior.StopHost -> DUNG CA IDENTITY SERVICE.
    // Hau qua that da gap: Docker restart, container vao crash loop exit 139,
    // toan bo luong dang nhap chet theo mot thanh phan chi phuc vu viec khoa
    // tai khoan vi spam.
    //
    // Gio: vong thu lai voi backoff. Mat RabbitMQ chi lam cham viec khoa tai
    // khoan, KHONG duoc phep lam sap dang nhap.
    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        var delay = TimeSpan.FromSeconds(5);
        var maxDelay = TimeSpan.FromSeconds(60);

        while (!stoppingToken.IsCancellationRequested)
        {
            try
            {
                await ConsumeUntilStoppedAsync(stoppingToken);
                return; // chi ve day khi duoc yeu cau dung han
            }
            catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested)
            {
                return;
            }
            catch (Exception ex)
            {
                logger.LogWarning(ex,
                    "Khong ket noi duoc RabbitMQ ({Host}:{Port}) - thu lai sau {Delay}s. " +
                    "Viec khoa/xoa tai khoan vi spam tam ngung, cac chuc nang khac van chay.",
                    options.HostName, options.Port, delay.TotalSeconds);

                await CleanupAsync();

                try { await Task.Delay(delay, stoppingToken); }
                catch (OperationCanceledException) { return; }

                delay = TimeSpan.FromSeconds(Math.Min(delay.TotalSeconds * 2, maxDelay.TotalSeconds));
            }
        }
    }

    private async Task ConsumeUntilStoppedAsync(CancellationToken stoppingToken)
    {
        var factory = new ConnectionFactory
        {
            HostName = options.HostName,
            Port = options.Port,
            UserName = options.Username,
            Password = options.Password,
            // Tu noi lai khi broker rot GIUA CHUNG (khac voi luc khoi dong -
            // truong hop do do vong thu lai o tren lo). Thieu cai nay thi
            // RabbitMQ restart mot cai la consumer im lang mai mai ma khong
            // he bao loi.
            AutomaticRecoveryEnabled = true,
            NetworkRecoveryInterval = TimeSpan.FromSeconds(10),
        };

        _connection = await factory.CreateConnectionAsync(stoppingToken);
        _channel = await _connection.CreateChannelAsync(cancellationToken: stoppingToken);

        // Bien cuc bo, KHONG dung field trong cac lambda ben duoi: sau mot
        // lan ket noi lai, field da tro sang channel moi trong khi consumer
        // cu van con song -> ack nham channel.
        var channel = _channel;

        await channel.QueueDeclareAsync(options.AccountLockedQueue, durable: true, exclusive: false, autoDelete: false, cancellationToken: stoppingToken);
        await channel.QueueDeclareAsync(options.DeleteAccountSpamQueue, durable: true, exclusive: false, autoDelete: false, cancellationToken: stoppingToken);

        var lockedConsumer = new AsyncEventingBasicConsumer(channel);
        lockedConsumer.ReceivedAsync += async (_, ea) =>
        {
            try
            {
                var message = JsonSerializer.Deserialize<AccountLockedMessage>(Encoding.UTF8.GetString(ea.Body.ToArray()));
                if (message is not null)
                    await LockAccountAsync(message);
                await channel.BasicAckAsync(ea.DeliveryTag, multiple: false);
            }
            catch (Exception ex)
            {
                logger.LogError(ex, "Loi xu ly message account-locked, requeue");
                await channel.BasicNackAsync(ea.DeliveryTag, multiple: false, requeue: true);
            }
        };
        await channel.BasicConsumeAsync(options.AccountLockedQueue, autoAck: false, lockedConsumer, stoppingToken);

        var deleteConsumer = new AsyncEventingBasicConsumer(channel);
        deleteConsumer.ReceivedAsync += async (_, ea) =>
        {
            try
            {
                var message = JsonSerializer.Deserialize<DeleteAccountSpamMessage>(Encoding.UTF8.GetString(ea.Body.ToArray()));
                if (message is not null)
                    await DeleteAccountAsync(message);
                await channel.BasicAckAsync(ea.DeliveryTag, multiple: false);
            }
            catch (Exception ex)
            {
                logger.LogError(ex, "Loi xu ly message delete-account-spam, requeue");
                await channel.BasicNackAsync(ea.DeliveryTag, multiple: false, requeue: true);
            }
        };
        await channel.BasicConsumeAsync(options.DeleteAccountSpamQueue, autoAck: false, deleteConsumer, stoppingToken);

        logger.LogInformation("Dang lang nghe queue '{Q1}' va '{Q2}'", options.AccountLockedQueue, options.DeleteAccountSpamQueue);

        // Giu BackgroundService song - consumer hoat dong qua event, khong can vong lap ban
        await Task.Delay(Timeout.Infinite, stoppingToken).ContinueWith(_ => { }, TaskScheduler.Default);
    }

    // Don sach truoc khi thu ket noi lai. Nuot loi o day la co y: doi tuong
    // dang hong thi Close cung hong, ma loi luc don dep khong duoc phep chen
    // mat ly do that su o tren.
    private async Task CleanupAsync()
    {
        try { if (_channel is not null) await _channel.CloseAsync(); } catch { }
        try { if (_connection is not null) await _connection.CloseAsync(); } catch { }
        _channel = null;
        _connection = null;
    }

    private async Task LockAccountAsync(AccountLockedMessage message)
    {
        using var scope = scopeFactory.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<IdentityDbContext>();

        var user = await db.Users.FindAsync(message.UserId);
        if (user is null)
        {
            logger.LogWarning("Nhan su kien khoa tai khoan cho user {UserId} nhung khong tim thay", message.UserId);
            return;
        }

        user.Status = UserStatus.Locked;
        await db.SaveChangesAsync();
        logger.LogInformation("Da khoa tai khoan {UserId}, ly do: {Reason}", message.UserId, message.Reason);
    }

    private async Task DeleteAccountAsync(DeleteAccountSpamMessage message)
    {
        using var scope = scopeFactory.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<IdentityDbContext>();

        var user = await db.Users.FindAsync(message.UserId);
        if (user is null)
        {
            logger.LogWarning("Nhan su kien xoa tai khoan cho user {UserId} nhung khong tim thay", message.UserId);
            return;
        }

        // Xoa vinh vien (xoa hang) - dung theo mo ta "status='locked' khi bi
        // khoa vi spam; xoa vinh vien = xoa han row" trong tai lieu roadmap
        // muc 3.2. oauth_links lien quan tu cascade xoa qua FK ON DELETE CASCADE.
        db.Users.Remove(user);
        await db.SaveChangesAsync();
        logger.LogInformation("Da xoa vinh vien tai khoan {UserId}, ly do: {Reason}", message.UserId, message.Reason);
    }

    // Dung CleanupAsync (nuot loi) thay vi CloseAsync truc tiep: neu ket noi
    // dang hong san - dung la truong hop hay xay ra nhat luc tat service -
    // thi CloseAsync nem loi ngay trong duong tat, lam qua trinh tat bi ban
    // hoac treo.
    public override async Task StopAsync(CancellationToken cancellationToken)
    {
        await CleanupAsync();
        await base.StopAsync(cancellationToken);
    }
}
