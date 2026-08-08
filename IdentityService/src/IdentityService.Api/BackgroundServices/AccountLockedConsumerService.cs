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

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        var factory = new ConnectionFactory
        {
            HostName = options.HostName,
            Port = options.Port,
            UserName = options.Username,
            Password = options.Password,
        };

        _connection = await factory.CreateConnectionAsync(stoppingToken);
        _channel = await _connection.CreateChannelAsync(cancellationToken: stoppingToken);
        await _channel.QueueDeclareAsync(options.AccountLockedQueue, durable: true, exclusive: false, autoDelete: false, cancellationToken: stoppingToken);
        await _channel.QueueDeclareAsync(options.DeleteAccountSpamQueue, durable: true, exclusive: false, autoDelete: false, cancellationToken: stoppingToken);

        var lockedConsumer = new AsyncEventingBasicConsumer(_channel);
        lockedConsumer.ReceivedAsync += async (_, ea) =>
        {
            try
            {
                var message = JsonSerializer.Deserialize<AccountLockedMessage>(Encoding.UTF8.GetString(ea.Body.ToArray()));
                if (message is not null)
                    await LockAccountAsync(message);
                await _channel.BasicAckAsync(ea.DeliveryTag, multiple: false);
            }
            catch (Exception ex)
            {
                logger.LogError(ex, "Loi xu ly message account-locked, requeue");
                await _channel.BasicNackAsync(ea.DeliveryTag, multiple: false, requeue: true);
            }
        };
        await _channel.BasicConsumeAsync(options.AccountLockedQueue, autoAck: false, lockedConsumer, stoppingToken);

        var deleteConsumer = new AsyncEventingBasicConsumer(_channel);
        deleteConsumer.ReceivedAsync += async (_, ea) =>
        {
            try
            {
                var message = JsonSerializer.Deserialize<DeleteAccountSpamMessage>(Encoding.UTF8.GetString(ea.Body.ToArray()));
                if (message is not null)
                    await DeleteAccountAsync(message);
                await _channel.BasicAckAsync(ea.DeliveryTag, multiple: false);
            }
            catch (Exception ex)
            {
                logger.LogError(ex, "Loi xu ly message delete-account-spam, requeue");
                await _channel.BasicNackAsync(ea.DeliveryTag, multiple: false, requeue: true);
            }
        };
        await _channel.BasicConsumeAsync(options.DeleteAccountSpamQueue, autoAck: false, deleteConsumer, stoppingToken);

        logger.LogInformation("Dang lang nghe queue '{Q1}' va '{Q2}'", options.AccountLockedQueue, options.DeleteAccountSpamQueue);

        // Giu BackgroundService song - consumer hoat dong qua event, khong can vong lap ban
        await Task.Delay(Timeout.Infinite, stoppingToken).ContinueWith(_ => { }, TaskScheduler.Default);
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

    public override async Task StopAsync(CancellationToken cancellationToken)
    {
        if (_channel is not null)
            await _channel.CloseAsync(cancellationToken);
        if (_connection is not null)
            await _connection.CloseAsync(cancellationToken);
        await base.StopAsync(cancellationToken);
    }
}
