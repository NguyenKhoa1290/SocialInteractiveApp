using System.Text;
using System.Text.Json;
using RabbitMQ.Client;

namespace ChatService.Api.Services;

public class RabbitMqOptions
{
    public string HostName { get; set; } = "localhost";
    public int Port { get; set; } = 5672;
    public string Username { get; set; } = "guest";
    public string Password { get; set; } = "guest";
    public string StorageWarningQueue { get; set; } = "identity.storage-warning";
    public string NewMessageQueue { get; set; } = "identity.chat-message-notification";
}

public record StorageWarningMessage(long WorkspaceId, long ConversationId, string Stage, DateTimeOffset? ExpiresAt, List<long> RecipientUserIds);

// Publish canh bao xoa file qua RabbitMQ -> Identity Services (push
// notification) - dung theo cung mo hinh voi cac thong bao khac trong tai
// lieu roadmap (muc 5.1). Identity Service consume hang doi nay va day tiep
// qua WebSocket, xem NotificationConsumerService.cs.
public class StorageWarningPublisher : IAsyncDisposable
{
    private readonly RabbitMqOptions _options;
    private readonly ILogger<StorageWarningPublisher> _logger;
    private IConnection? _connection;
    private IChannel? _channel;
    private readonly SemaphoreSlim _initLock = new(1, 1);

    public StorageWarningPublisher(RabbitMqOptions options, ILogger<StorageWarningPublisher> logger)
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
            await _channel.QueueDeclareAsync(_options.StorageWarningQueue, durable: true, exclusive: false, autoDelete: false);
            return _channel;
        }
        finally
        {
            _initLock.Release();
        }
    }

    public async Task PublishAsync(long workspaceId, long conversationId, string stage, DateTimeOffset? expiresAt, List<long> recipientUserIds)
    {
        try
        {
            var channel = await EnsureChannelAsync();
            var body = Encoding.UTF8.GetBytes(JsonSerializer.Serialize(new StorageWarningMessage(workspaceId, conversationId, stage, expiresAt, recipientUserIds)));
            await channel.BasicPublishAsync(exchange: "", routingKey: _options.StorageWarningQueue, body: body);
        }
        catch (Exception ex)
        {
            _logger.LogWarning(ex, "Khong publish duoc storage warning cho conversation {ConversationId} stage {Stage}", conversationId, stage);
        }
    }

    public async ValueTask DisposeAsync()
    {
        if (_channel is not null) await _channel.CloseAsync();
        if (_connection is not null) await _connection.CloseAsync();
    }
}
