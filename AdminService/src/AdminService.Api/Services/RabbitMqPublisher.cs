using System.Text;
using System.Text.Json;
using RabbitMQ.Client;

namespace AdminService.Api.Services;

public class RabbitMqOptions
{
    public string HostName { get; set; } = "localhost";
    public int Port { get; set; } = 5672;
    public string Username { get; set; } = "guest";
    public string Password { get; set; } = "guest";

    // PHAI trung ten voi queue Identity Service da khai bao trong
    // AccountLockedConsumerService (xem SpamTrackingService.Api/Services/RabbitMqPublisher.cs
    // - da xac nhan format khop thuc te khi SpamTrackingService duoc xay dung).
    public string DeleteAccountSpamQueue { get; set; } = "identity.delete-account-spam";
}

public record DeleteAccountSpamMessage(long UserId, string Reason);

public class RabbitMqPublisher : IAsyncDisposable
{
    private readonly RabbitMqOptions _options;
    private readonly ILogger<RabbitMqPublisher> _logger;
    private IConnection? _connection;
    private IChannel? _channel;
    private readonly SemaphoreSlim _initLock = new(1, 1);

    public RabbitMqPublisher(RabbitMqOptions options, ILogger<RabbitMqPublisher> logger)
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
            await _channel.QueueDeclareAsync(_options.DeleteAccountSpamQueue, durable: true, exclusive: false, autoDelete: false);
            return _channel;
        }
        finally
        {
            _initLock.Release();
        }
    }

    public async Task PublishDeleteAccountSpamAsync(long userId, string reason)
    {
        var channel = await EnsureChannelAsync();
        var body = Encoding.UTF8.GetBytes(JsonSerializer.Serialize(new DeleteAccountSpamMessage(userId, reason)));
        await channel.BasicPublishAsync(exchange: "", routingKey: _options.DeleteAccountSpamQueue, body: body);
    }

    public async ValueTask DisposeAsync()
    {
        if (_channel is not null) await _channel.CloseAsync();
        if (_connection is not null) await _connection.CloseAsync();
    }
}
