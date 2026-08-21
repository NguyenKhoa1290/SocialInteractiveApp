using System.Text;
using System.Text.Json;
using RabbitMQ.Client;

namespace ChatService.Api.Services;

// RecipientUserIds + SenderNickname do BEN NAY tinh san. Identity Service
// khong co ban sao thanh vien hoi thoai; de no tu tra thi phai goi nguoc lai
// Chat Service - vong phu thuoc, va thong bao se chet neu Chat dang ban.
public record ChatMessageNotificationMessage(long ConversationId, long MessageId, long SenderId, string MessageType, string? SenderNickname, List<long> RecipientUserIds);

// Publish thong bao tin nhan moi -> Identity Service, noi dong vai tro dau
// moi notification cua ca he thong (roadmap muc 1 va bang Publisher ->
// Consumer muc 8.1). Identity luu lai roi day tiep xuong nguoi nhan qua
// WebSocket - xem NotificationConsumerService.cs ben do.
public class ChatMessageNotificationPublisher : IAsyncDisposable
{
    private readonly RabbitMqOptions _options;
    private readonly ILogger<ChatMessageNotificationPublisher> _logger;
    private IConnection? _connection;
    private IChannel? _channel;
    private readonly SemaphoreSlim _initLock = new(1, 1);

    public ChatMessageNotificationPublisher(RabbitMqOptions options, ILogger<ChatMessageNotificationPublisher> logger)
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
            await _channel.QueueDeclareAsync(_options.NewMessageQueue, durable: true, exclusive: false, autoDelete: false);
            return _channel;
        }
        finally
        {
            _initLock.Release();
        }
    }

    public async Task PublishAsync(long conversationId, long messageId, long senderId, string messageType, string? senderNickname, List<long> recipientUserIds)
    {
        if (recipientUserIds.Count == 0)
            return;

        try
        {
            var channel = await EnsureChannelAsync();
            var body = Encoding.UTF8.GetBytes(JsonSerializer.Serialize(
                new ChatMessageNotificationMessage(conversationId, messageId, senderId, messageType, senderNickname, recipientUserIds)));
            await channel.BasicPublishAsync(exchange: "", routingKey: _options.NewMessageQueue, body: body);
        }
        catch (Exception ex)
        {
            _logger.LogWarning(ex, "Khong publish duoc thong bao tin nhan moi cho conversation {ConversationId}", conversationId);
        }
    }

    public async ValueTask DisposeAsync()
    {
        if (_channel is not null) await _channel.CloseAsync();
        if (_connection is not null) await _connection.CloseAsync();
    }
}
