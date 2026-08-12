using System.Text.Json;
using Confluent.Kafka;

namespace ChatService.Api.Services;

public class KafkaOptions
{
    public string BootstrapServers { get; set; } = "localhost:9092";
    public string ChatLogTopic { get; set; } = "chat.service-log";
    public string ErrorLogTopic { get; set; } = "system.error-log";
}

// Content duoc dua vao day du (khong chi metadata) vi day chinh la nguon du
// lieu SpamTrackingService dung de phan tich (tan suat, noi dung trung lap,
// tu khoa) - xem tai lieu roadmap muc 8.1. Chi anh huong toi topic Kafka,
// KHONG luu them o dau khac - Social DB van la nguon su that duy nhat.
public record ChatLogEvent(long ConversationId, long MessageId, long? SenderId, string MessageType, string? Content, DateTimeOffset OccurredAt);

// Publish "Chat Service Log" len Kafka sau moi tin nhan - dung theo mo ta
// tai lieu roadmap muc 6.1 (nguon cho consumer "Write Chat" dong bo Redis,
// va Search Chat Service, va SpamTrackingService o Phase 3).
public class KafkaProducerService : IAsyncDisposable
{
    private readonly IProducer<Null, string> _producer;
    private readonly string _topic;
    private readonly ILogger<KafkaProducerService> _logger;

    public KafkaProducerService(KafkaOptions options, ILogger<KafkaProducerService> logger)
    {
        _topic = options.ChatLogTopic;
        _logger = logger;
        _producer = new ProducerBuilder<Null, string>(
            new ProducerConfig { BootstrapServers = options.BootstrapServers }).Build();
    }

    public async Task PublishChatLogAsync(long conversationId, long messageId, long? senderId, string messageType, string? content)
    {
        var evt = new ChatLogEvent(conversationId, messageId, senderId, messageType, content, DateTimeOffset.UtcNow);
        try
        {
            await _producer.ProduceAsync(_topic, new Message<Null, string> { Value = JsonSerializer.Serialize(evt) });
        }
        catch (ProduceException<Null, string> ex)
        {
            _logger.LogWarning(ex, "Khong publish duoc Chat Service Log len Kafka: conversation {ConversationId} message {MessageId}", conversationId, messageId);
        }
    }

    public ValueTask DisposeAsync()
    {
        _producer.Flush(TimeSpan.FromSeconds(3));
        _producer.Dispose();
        return ValueTask.CompletedTask;
    }
}
