using System.Text;
using System.Text.Json;
using RabbitMQ.Client;

namespace SpamTrackingService.Api.Services;

public class RabbitMqOptions
{
    public string HostName { get; set; } = "localhost";
    public int Port { get; set; } = 5672;
    public string Username { get; set; } = "guest";
    public string Password { get; set; } = "guest";

    // Queue "identity.account-locked" PHAI trung ten voi queue Identity Service
    // da khai bao trong AccountLockedConsumerService (Phase 1) - SpamTrackingService
    // bay gio la nguon publish THAT cho queue do (truoc day chi test publish thu cong).
    public string AccountLockedQueue { get; set; } = "identity.account-locked";
    public string DeleteAccountSpamQueue { get; set; } = "identity.delete-account-spam";
}

// Format PHAI khop chinh xac voi AccountLockedMessage ben IdentityService
// (IdentityService/src/IdentityService.Api/BackgroundServices/AccountLockedConsumerService.cs)
public record AccountLockedMessage(long UserId, string Reason);
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
            await _channel.QueueDeclareAsync(_options.AccountLockedQueue, durable: true, exclusive: false, autoDelete: false);
            await _channel.QueueDeclareAsync(_options.DeleteAccountSpamQueue, durable: true, exclusive: false, autoDelete: false);
            return _channel;
        }
        finally
        {
            _initLock.Release();
        }
    }

    public async Task PublishAccountLockedAsync(long userId, string reason)
    {
        try
        {
            var channel = await EnsureChannelAsync();
            var body = Encoding.UTF8.GetBytes(JsonSerializer.Serialize(new AccountLockedMessage(userId, reason)));
            await channel.BasicPublishAsync(exchange: "", routingKey: _options.AccountLockedQueue, body: body);
        }
        catch (Exception ex)
        {
            _logger.LogWarning(ex, "Khong publish duoc AccountLocked cho user {UserId}", userId);
        }
    }

    public async Task PublishDeleteAccountSpamAsync(long userId, string reason)
    {
        try
        {
            var channel = await EnsureChannelAsync();
            var body = Encoding.UTF8.GetBytes(JsonSerializer.Serialize(new DeleteAccountSpamMessage(userId, reason)));
            await channel.BasicPublishAsync(exchange: "", routingKey: _options.DeleteAccountSpamQueue, body: body);
        }
        catch (Exception ex)
        {
            _logger.LogWarning(ex, "Khong publish duoc DeleteAccountSpam cho user {UserId}", userId);
        }
    }

    public async ValueTask DisposeAsync()
    {
        if (_channel is not null) await _channel.CloseAsync();
        if (_connection is not null) await _connection.CloseAsync();
    }
}
