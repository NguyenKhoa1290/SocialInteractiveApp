using System.Text;
using System.Text.Json;
using RabbitMQ.Client;

namespace WorkspaceService.Api.Services;

public class RabbitMqOptions
{
    public string HostName { get; set; } = "localhost";
    public int Port { get; set; } = 5672;
    public string Username { get; set; } = "guest";
    public string Password { get; set; } = "guest";
    public string MemberNotificationQueue { get; set; } = "workspace.member-notifications";
}

public record MemberNotificationMessage(string EventType, long WorkspaceId, long UserId, DateTimeOffset OccurredAt);

// Publish thong bao roi/bi xoa/giai tan nhom qua RabbitMQ -> Identity Services
// (push notification), dung theo mo ta tai lieu roadmap muc 5.1. LUU Y: Identity
// Service HIEN CHUA co consumer cho queue nay (chi moi co AccountLockedConsumerService
// cho spam) - can bo sung consumer ben do khi lam push notification that.
public class MemberNotificationPublisher : IAsyncDisposable
{
    private readonly RabbitMqOptions _options;
    private readonly ILogger<MemberNotificationPublisher> _logger;
    private IConnection? _connection;
    private IChannel? _channel;
    private readonly SemaphoreSlim _initLock = new(1, 1);

    public MemberNotificationPublisher(RabbitMqOptions options, ILogger<MemberNotificationPublisher> logger)
    {
        _options = options;
        _logger = logger;
    }

    private async Task<IChannel> EnsureChannelAsync()
    {
        if (_channel is { IsOpen: true })
            return _channel;

        await _initLock.WaitAsync();
        try
        {
            if (_channel is { IsOpen: true })
                return _channel;

            var factory = new ConnectionFactory
            {
                HostName = _options.HostName,
                Port = _options.Port,
                UserName = _options.Username,
                Password = _options.Password,
            };
            _connection = await factory.CreateConnectionAsync();
            _channel = await _connection.CreateChannelAsync();
            await _channel.QueueDeclareAsync(_options.MemberNotificationQueue, durable: true, exclusive: false, autoDelete: false);
            return _channel;
        }
        finally
        {
            _initLock.Release();
        }
    }

    public async Task PublishAsync(string eventType, long workspaceId, long userId)
    {
        try
        {
            var channel = await EnsureChannelAsync();
            var message = new MemberNotificationMessage(eventType, workspaceId, userId, DateTimeOffset.UtcNow);
            var body = Encoding.UTF8.GetBytes(JsonSerializer.Serialize(message));
            await channel.BasicPublishAsync(exchange: "", routingKey: _options.MemberNotificationQueue, body: body);
        }
        catch (Exception ex)
        {
            // Khong de loi publish RabbitMQ lam fail request chinh - chi log canh bao.
            _logger.LogWarning(ex, "Khong publish duoc member notification: {EventType} workspace {WorkspaceId} user {UserId}",
                eventType, workspaceId, userId);
        }
    }

    public async ValueTask DisposeAsync()
    {
        if (_channel is not null) await _channel.CloseAsync();
        if (_connection is not null) await _connection.CloseAsync();
    }
}
