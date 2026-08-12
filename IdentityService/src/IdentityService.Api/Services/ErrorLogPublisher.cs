using System.Text.Json;
using Confluent.Kafka;

namespace IdentityService.Api.Services;

public record ErrorLogEvent(string Service, string Message, string? StackTrace, string Path, DateTimeOffset OccurredAt);

// Publish loi he thong (unhandled exception) len Kafka topic "Error Log" -
// dung theo tai lieu roadmap muc 1/8.1: "Error Log (chi o muc he thong
// tong the, phuc vu admin/ops, CHUA co consumer cu the)". Tu de xuat phan
// PRODUCER (tai lieu goc khong dac ta consumer nao, dung y "chua co" theo
// dung nghia - chua xay dung consumer, chi chuan bi du lieu san cho cong cu
// ops/ELK sau nay). Ap dung cho 3 service da co san Kafka client (Identity,
// Chat, SpamTracking) - KHONG ap dung cho WorkSpace/Admin/Media vi 3 service
// do chua tich hop Kafka, them moi chi cho tinh nang phu nay khong tuong
// xung chi phi/loi ich.
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
            // Khong duoc de loi publish Error Log lam mat luon exception goc -
            // chi log canh bao, KHONG throw tiep.
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
