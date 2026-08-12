using System.Text.Json;
using Confluent.Kafka;

namespace IdentityService.Api.Services;

public class KafkaOptions
{
    public string BootstrapServers { get; set; } = "localhost:9092";
    public string AuthHistoryTopic { get; set; } = "identity.auth-history";
    public string ErrorLogTopic { get; set; } = "system.error-log";
}

public record AuthHistoryEvent(string EventType, long UserId, string? Email, string UserType, DateTimeOffset OccurredAt);

// Publish "Login" + "Register History" len Kafka lam audit log - dung theo
// mo ta trong tai lieu roadmap muc 3.1 "Lien ket voi cac thanh phan khac".
public class KafkaProducerService : IAsyncDisposable
{
    private readonly IProducer<Null, string> _producer;
    private readonly string _topic;
    private readonly ILogger<KafkaProducerService> _logger;

    public KafkaProducerService(KafkaOptions options, ILogger<KafkaProducerService> logger)
    {
        _topic = options.AuthHistoryTopic;
        _logger = logger;
        _producer = new ProducerBuilder<Null, string>(
            new ProducerConfig { BootstrapServers = options.BootstrapServers }).Build();
    }

    public async Task PublishAuthEventAsync(string eventType, long userId, string? email, string userType)
    {
        var evt = new AuthHistoryEvent(eventType, userId, email, userType, DateTimeOffset.UtcNow);
        var json = JsonSerializer.Serialize(evt);

        try
        {
            await _producer.ProduceAsync(_topic, new Message<Null, string> { Value = json });
        }
        catch (ProduceException<Null, string> ex)
        {
            // Khong de loi publish Kafka lam fail request auth chinh - chi log canh bao.
            _logger.LogWarning(ex, "Khong publish duoc auth event len Kafka: {EventType} user {UserId}", eventType, userId);
        }
    }

    public ValueTask DisposeAsync()
    {
        _producer.Flush(TimeSpan.FromSeconds(3));
        _producer.Dispose();
        return ValueTask.CompletedTask;
    }
}
