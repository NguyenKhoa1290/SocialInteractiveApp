using System.Text;
using System.Text.Json;
using IdentityService.Api.Models;
using IdentityService.Api.Services;
using RabbitMQ.Client;
using RabbitMQ.Client.Events;

namespace IdentityService.Api.BackgroundServices;

// Cac hinh dang message PHAI khop voi ben publish:
//   ChatService/.../Services/ChatMessageNotificationPublisher.cs
//   ChatService/.../Services/StorageWarningPublisher.cs
//   WorkspaceService/.../Services/MemberNotificationPublisher.cs
//   MediaService/.../Services/MeetingInviteNotificationPublisher.cs
//
// RecipientUserIds do BEN PUBLISH tinh san. Ly do: Identity Service khong co
// ban sao thanh vien nhom hay hoi thoai, neu de no tu tra thi phai goi nguoc
// sang Chat/WorkSpace - them hai phu thuoc chi de gui mot thong bao, va
// thong bao se chet neu hai service do dang ban.
public record MemberNotificationMessage(string EventType, long WorkspaceId, long UserId, DateTimeOffset OccurredAt);
public record StorageWarningMessage(long WorkspaceId, long ConversationId, string Stage, DateTimeOffset? ExpiresAt, List<long>? RecipientUserIds);
public record ChatMessageNotificationMessage(long ConversationId, long MessageId, long SenderId, string MessageType, string? SenderNickname, List<long>? RecipientUserIds);
public record MeetingInviteMessage(long MeetingId, long InvitedUserId, long InvitedBy, string InviteToken, string? InviterNickname);

// Dau moi notification cua toan he thong (roadmap muc 1 va bang
// Publisher -> Consumer muc 8.1): moi service khac publish su kien can bao
// cho nguoi dung vao RabbitMQ, Identity luu lai roi day tiep qua WebSocket.
//
// Truoc day bon hang doi nay KHONG AI consume - thong bao roi vao hu khong.
public class NotificationConsumerService(
    IServiceScopeFactory scopeFactory,
    RabbitMqOptions options,
    ILogger<NotificationConsumerService> logger) : BackgroundService
{
    private IConnection? _connection;
    private IChannel? _channel;

    // Cung ly do voi AccountLockedConsumerService: RabbitMQ len sau la chuyen
    // binh thuong, va loi thoat ra khoi ExecuteAsync se lam DUNG CA IDENTITY
    // SERVICE (BackgroundServiceExceptionBehavior.StopHost mac dinh cua .NET).
    // Mat thong bao khong duoc phep keo sap dang nhap.
    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        var delay = TimeSpan.FromSeconds(5);
        var maxDelay = TimeSpan.FromSeconds(60);

        while (!stoppingToken.IsCancellationRequested)
        {
            try
            {
                await ConsumeUntilStoppedAsync(stoppingToken);
                return;
            }
            catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested)
            {
                return;
            }
            catch (Exception ex)
            {
                logger.LogWarning(ex, "Mat ket noi RabbitMQ (notification), thu lai sau {Delay}s", delay.TotalSeconds);
                await CleanupAsync();
                try { await Task.Delay(delay, stoppingToken); } catch (OperationCanceledException) { return; }
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
            AutomaticRecoveryEnabled = true,
            NetworkRecoveryInterval = TimeSpan.FromSeconds(10),
        };

        _connection = await factory.CreateConnectionAsync(stoppingToken);
        _channel = await _connection.CreateChannelAsync(cancellationToken: stoppingToken);

        // Bien cuc bo, KHONG dung field trong lambda: sau mot lan ket noi lai
        // field da tro sang channel moi trong khi consumer cu con song -> ack
        // nham channel.
        var channel = _channel;

        var queues = new[]
        {
            options.MemberNotificationQueue,
            options.StorageWarningQueue,
            options.NewMessageQueue,
            options.MeetingInviteQueue,
        };
        foreach (var q in queues)
            await channel.QueueDeclareAsync(q, durable: true, exclusive: false, autoDelete: false, cancellationToken: stoppingToken);

        await SubscribeAsync<MemberNotificationMessage>(channel, options.MemberNotificationQueue, HandleMemberAsync, stoppingToken);
        await SubscribeAsync<StorageWarningMessage>(channel, options.StorageWarningQueue, HandleStorageAsync, stoppingToken);
        await SubscribeAsync<ChatMessageNotificationMessage>(channel, options.NewMessageQueue, HandleNewMessageAsync, stoppingToken);
        await SubscribeAsync<MeetingInviteMessage>(channel, options.MeetingInviteQueue, HandleMeetingInviteAsync, stoppingToken);

        logger.LogInformation("Dang lang nghe {Count} hang doi thong bao: {Queues}", queues.Length, string.Join(", ", queues));

        // Giu BackgroundService song - consumer hoat dong qua event.
        await Task.Delay(Timeout.Infinite, stoppingToken).ContinueWith(_ => { }, TaskScheduler.Default);
    }

    private async Task SubscribeAsync<T>(IChannel channel, string queue, Func<T, Task> handle, CancellationToken ct)
    {
        var consumer = new AsyncEventingBasicConsumer(channel);
        consumer.ReceivedAsync += async (_, ea) =>
        {
            try
            {
                var message = JsonSerializer.Deserialize<T>(Encoding.UTF8.GetString(ea.Body.ToArray()));
                if (message is not null)
                    await handle(message);
                await channel.BasicAckAsync(ea.DeliveryTag, multiple: false);
            }
            catch (JsonException ex)
            {
                // Message hong dinh dang thi requeue chi lam no quay vong mai -
                // bo di va ghi log. Khac han loi tam thoi o nhanh duoi.
                logger.LogError(ex, "Message hong dinh dang tren queue {Queue}, bo qua", queue);
                await channel.BasicAckAsync(ea.DeliveryTag, multiple: false);
            }
            catch (Exception ex)
            {
                logger.LogError(ex, "Loi xu ly message tren queue {Queue}, requeue", queue);
                await channel.BasicNackAsync(ea.DeliveryTag, multiple: false, requeue: true);
            }
        };
        await channel.BasicConsumeAsync(queue, autoAck: false, consumer, ct);
    }

    private async Task HandleMemberAsync(MemberNotificationMessage m)
    {
        var (type, title, body) = m.EventType switch
        {
            "member_kicked" => (NotificationType.MemberKicked, "Bạn đã bị xoá khỏi nhóm",
                "Trưởng nhóm đã xoá bạn khỏi một nhóm."),
            "workspace_dissolved" => (NotificationType.WorkspaceDissolved, "Một nhóm của bạn đã bị giải tán",
                "Trưởng nhóm đã xoá nhóm — toàn bộ tin nhắn và file trong đó đã mất."),
            _ => (NotificationType.MemberLeft, "Bạn đã rời nhóm",
                "Bạn không còn là thành viên của nhóm này."),
        };

        using var scope = scopeFactory.CreateScope();
        var notifications = scope.ServiceProvider.GetRequiredService<NotificationService>();
        // Khong dat link: nhom vua bi roi/xoa thi khong con gi de bam vao.
        await notifications.CreateAsync(m.UserId, type, title, body);
    }

    private async Task HandleStorageAsync(StorageWarningMessage m)
    {
        if (m.RecipientUserIds is not { Count: > 0 })
        {
            logger.LogWarning("Canh bao dung luong nhom {WorkspaceId} khong kem nguoi nhan, bo qua", m.WorkspaceId);
            return;
        }

        var remaining = m.Stage switch
        {
            "3d" => "3 ngày",
            "2d" => "2 ngày",
            "1d" => "1 ngày",
            _ => "10 giờ",
        };

        using var scope = scopeFactory.CreateScope();
        var notifications = scope.ServiceProvider.GetRequiredService<NotificationService>();
        await notifications.CreateManyAsync(
            m.RecipientUserIds,
            NotificationType.StorageWarning,
            $"Nhóm sắp hết hạn dung lượng (còn {remaining})",
            "Hết hạn mà chưa nạp thêm thì các file cũ nhất sẽ bị xoá dần cho tới khi về dưới hạn mức.",
            $"/chat/{m.ConversationId}");
    }

    private async Task HandleNewMessageAsync(ChatMessageNotificationMessage m)
    {
        if (m.RecipientUserIds is not { Count: > 0 })
            return;

        var who = string.IsNullOrWhiteSpace(m.SenderNickname) ? "Ai đó" : m.SenderNickname;
        var what = m.MessageType switch
        {
            "image" => "đã gửi một ảnh",
            "video" => "đã gửi một video",
            "voice" => "đã gửi một tin nhắn thoại",
            "file" => "đã gửi một tệp",
            "vote" => "đã tạo một bình chọn",
            // Tin Text la ciphertext (E2EE) - server KHONG doc duoc, nen thong
            // bao chi noi duoc "co tin nhan moi", khong the xem truoc noi dung.
            _ => "đã gửi cho bạn một tin nhắn",
        };

        using var scope = scopeFactory.CreateScope();
        var notifications = scope.ServiceProvider.GetRequiredService<NotificationService>();
        await notifications.CreateManyAsync(
            m.RecipientUserIds,
            NotificationType.NewMessage,
            $"{who} {what}",
            null,
            $"/chat/{m.ConversationId}");
    }

    private async Task HandleMeetingInviteAsync(MeetingInviteMessage m)
    {
        var who = string.IsNullOrWhiteSpace(m.InviterNickname) ? "Một người bạn" : m.InviterNickname;

        using var scope = scopeFactory.CreateScope();
        var notifications = scope.ServiceProvider.GetRequiredService<NotificationService>();
        await notifications.CreateAsync(
            m.InvitedUserId,
            NotificationType.MeetingInvite,
            $"{who} mời bạn vào cuộc họp",
            "Lời mời có hiệu lực trong 24 giờ.",
            $"/meetings/join/{m.InviteToken}");
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
}
