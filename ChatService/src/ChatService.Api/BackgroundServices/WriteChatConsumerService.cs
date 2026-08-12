using System.Text.Json;
using ChatService.Api.Data;
using ChatService.Api.Services;
using Confluent.Kafka;
using Microsoft.EntityFrameworkCore;

namespace ChatService.Api.BackgroundServices;

public class WriteChatConsumerOptions
{
    public string ConsumerGroupId { get; set; } = "chat-service-write-chat";
}

// Format PHAI khop voi ChatLogEvent trong KafkaProducerService.cs (cung
// service tu publish, tu consume lai chinh topic do minh).
public record ChatLogEventForCache(long ConversationId, long MessageId, long? SenderId, string MessageType, string? Content, DateTimeOffset OccurredAt);

// Consumer "Write Chat" - dong bo Redis tu Kafka (tu de xuat, hoan thanh
// muc con thieu trong tai lieu roadmap muc 6.4). Tach RIENG khoi write path
// chinh (POST /conversations/{id}/messages) dung theo nguyen tac da neu o
// tai lieu roadmap muc 1: "Ghi Postgres truoc, publish event de dong bo
// Redis sau - tach write path khoi cache update" - neu Redis cham/down,
// API gui tin nhan van khong bi anh huong, chi cache "nong" bi cham theo.
//
// Doc lai tu Postgres (khong dung thang Content trong Kafka event) vi
// ChatLogEvent.Content = null cho tin nhan Text da ma hoa (E2EE, xem
// SpamDetector.cs va ConversationEndpoints.cs) - Kafka event chi dung de
// TRIGGER dong bo, khong phai nguon du lieu day du.
public class WriteChatConsumerService(
    IServiceScopeFactory scopeFactory,
    KafkaOptions kafkaOptions,
    WriteChatConsumerOptions consumerOptions,
    ILogger<WriteChatConsumerService> logger) : BackgroundService
{
    protected override Task ExecuteAsync(CancellationToken stoppingToken) =>
        Task.Run(() => ConsumeLoop(stoppingToken), stoppingToken);

    private void ConsumeLoop(CancellationToken stoppingToken)
    {
        var config = new ConsumerConfig
        {
            BootstrapServers = kafkaOptions.BootstrapServers,
            GroupId = consumerOptions.ConsumerGroupId,
            AutoOffsetReset = AutoOffsetReset.Latest, // chi can cache "nong" tu bay gio, khong can replay toan bo lich su cu
        };

        using var consumer = new ConsumerBuilder<Null, string>(config).Build();
        consumer.Subscribe(kafkaOptions.ChatLogTopic);
        logger.LogInformation("WriteChatConsumerService dang lang nghe topic '{Topic}' de dong bo Redis", kafkaOptions.ChatLogTopic);

        while (!stoppingToken.IsCancellationRequested)
        {
            try
            {
                var result = consumer.Consume(stoppingToken);
                if (result?.Message?.Value is null)
                    continue;

                var evt = JsonSerializer.Deserialize<ChatLogEventForCache>(result.Message.Value);
                if (evt is null)
                    continue;

                ProcessEventAsync(evt).GetAwaiter().GetResult();
            }
            catch (OperationCanceledException)
            {
                break;
            }
            catch (Exception ex)
            {
                logger.LogError(ex, "Loi xu ly Write Chat event");
            }
        }

        consumer.Close();
    }

    private async Task ProcessEventAsync(ChatLogEventForCache evt)
    {
        using var scope = scopeFactory.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<ChatDbContext>();
        var cache = scope.ServiceProvider.GetRequiredService<ChatCacheService>();

        var message = await db.Messages.FindAsync(evt.MessageId);
        if (message is null)
            return; // co the da bi xoa vinh vien / cascade truoc khi consumer kip xu ly (hiem)

        var fileId = await db.Files
            .Where(f => f.MessageId == message.Id)
            .Select(f => (long?)f.Id)
            .FirstOrDefaultAsync();

        await cache.CacheMessageAsync(new CachedMessage(
            message.Id, message.ConversationId, message.SenderId,
            Models.Message.TypeToString(message.Type), message.Content,
            fileId, message.IsDeleted, message.CreatedAt, message.IsEncrypted, message.ContentNonce,
            message.IsEdited, message.EditedAt));
    }
}
