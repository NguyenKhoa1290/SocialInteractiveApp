using System.Text.Json;
using Confluent.Kafka;

namespace ChatService.Api.Services;

public record ErrorLogEvent(string Service, string Message, string? StackTrace, string Path, DateTimeOffset OccurredAt);

// Publish loi he thong (unhandled exception) len Kafka topic "Error Log" -
// dung theo tai lieu roadmap muc 1/8.1. Xem giai thich day du o
// IdentityService.Api/Services/ErrorLogPublisher.cs (cung pattern, tach
// rieng theo tung service).
public class ErrorLogPublisher : IAsyncDisposable
{
    private readonly IProducer<Null, string> _producer;
    private readonly string _topic;
    private readonly string _serviceName;
    private readonly ILogger<ErrorLogPublisher> _logger;

    public ErrorLogPublisher(KafkaOptions options, ILogger<ErrorLogPublisher> logger, string serviceName)
    {
        _topic = options.ErrorLogTopic;
        _serviceName = serviceName;
        _logger = logger;
        _producer = new ProducerBuilder<Null, string>(
            new ProducerConfig { BootstrapServers = options.BootstrapServers }).Build();
    }

    public async Task PublishAsync(Exception ex, string path)
    {
        var evt = new ErrorLogEvent(_serviceName, ex.Message, ex.StackTrace, path, DateTimeOffset.UtcNow);
        try
        {
            await _producer.ProduceAsync(_topic, new Message<Null, string> { Value = JsonSerializer.Serialize(evt) });
        }
        catch (ProduceException<Null, string> produceEx)
        {
            _logger.LogWarning(produceEx, "Khong publish duoc Error Log len Kafka");
        }
    }

    public ValueTask DisposeAsync()
    {
        _producer.Flush(TimeSpan.FromSeconds(3));
        _producer.Dispose();
        return ValueTask.CompletedTask;
    }
}
