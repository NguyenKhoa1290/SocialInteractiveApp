using System.Text.Json;
using Confluent.Kafka;
using Microsoft.EntityFrameworkCore;
using SpamTrackingService.Api.Data;
using SpamTrackingService.Api.Models;
using SpamTrackingService.Api.Services;

namespace SpamTrackingService.Api.BackgroundServices;

public class KafkaOptions
{
    public string BootstrapServers { get; set; } = "localhost:9092";
    public string ChatLogTopic { get; set; } = "chat.service-log";
    public string ConsumerGroupId { get; set; } = "spamtracking-service";
    public string ErrorLogTopic { get; set; } = "system.error-log";
}

// Format PHAI khop voi ChatLogEvent ben ChatService
// (ChatService/src/ChatService.Api/Services/KafkaProducerService.cs)
public record ChatLogEvent(long ConversationId, long MessageId, long? SenderId, string MessageType, string? Content, DateTimeOffset OccurredAt);

// Consume Chat Log tu Kafka, phan tich spam bat dong bo - dung theo mo ta
// tai lieu roadmap muc 8.1. Do la consume bat dong bo nen luon co do tre tu
// nhien (UC-11, luong ngoai le 2a) - khong co cach nao "ep" phan tich ngay.
//
// QUYET DINH TU DUA RA (khong co trong tai lieu goc, vi Admin Service - noi
// ra quyet dinh Delete Account Spam theo UC-12 - CHUA duoc xay dung o Phase 3):
// tu dong leo thang - vi pham LAN DAU cua 1 user -> khoa tai khoan; vi pham
// TIEP THEO (da co ban ghi vi pham truoc do) -> tu dong xoa vinh vien, khong
// cho Admin duyet. Se can sua lai logic nay khi Admin Service (Phase 4) that
// su dua ra quyet dinh do con nguoi thay vi tu dong.
public class ChatLogConsumerService(
    IServiceScopeFactory scopeFactory,
    KafkaOptions kafkaOptions,
    ILogger<ChatLogConsumerService> logger) : BackgroundService
{
    protected override Task ExecuteAsync(CancellationToken stoppingToken)
    {
        return Task.Run(() => ConsumeLoop(stoppingToken), stoppingToken);
    }

    private void ConsumeLoop(CancellationToken stoppingToken)
    {
        var config = new ConsumerConfig
        {
            BootstrapServers = kafkaOptions.BootstrapServers,
            GroupId = kafkaOptions.ConsumerGroupId,
            AutoOffsetReset = AutoOffsetReset.Earliest,
        };

        using var consumer = new ConsumerBuilder<Null, string>(config).Build();
        consumer.Subscribe(kafkaOptions.ChatLogTopic);
        logger.LogInformation("ChatLogConsumerService dang lang nghe topic '{Topic}'", kafkaOptions.ChatLogTopic);

        while (!stoppingToken.IsCancellationRequested)
        {
            try
            {
                var result = consumer.Consume(stoppingToken);
                if (result?.Message?.Value is null)
                    continue;

                var evt = JsonSerializer.Deserialize<ChatLogEvent>(result.Message.Value);
                if (evt?.SenderId is null)
                    continue; // tin nhan he thong (sender null) - bo qua

                ProcessEventAsync(evt).GetAwaiter().GetResult();
            }
            catch (OperationCanceledException)
            {
                break;
            }
            catch (Exception ex)
            {
                logger.LogError(ex, "Loi xu ly Chat Log event");
            }
        }

        consumer.Close();
    }

    private async Task ProcessEventAsync(ChatLogEvent evt)
    {
        using var scope = scopeFactory.CreateScope();
        var detector = scope.ServiceProvider.GetRequiredService<SpamDetector>();
        var db = scope.ServiceProvider.GetRequiredService<SpamTrackingDbContext>();
        var publisher = scope.ServiceProvider.GetRequiredService<RabbitMqPublisher>();

        var userId = evt.SenderId!.Value;
        var check = await detector.CheckAsync(userId, evt.Content);
        if (!check.IsViolation)
            return;

        var hasExistingViolation = await db.Violations.AnyAsync(v => v.UserId == userId);
        var reason = string.Join("; ", check.Reasons);
        var status = hasExistingViolation ? AccountStatus.Deleted : AccountStatus.Locked;

        db.Violations.Add(new Violation
        {
            UserId = userId,
            DetectedAt = DateTimeOffset.UtcNow,
            Reason = reason,
            AccountStatus = status,
            Score = check.Score,
        });
        await db.SaveChangesAsync();

        if (status == AccountStatus.Locked)
        {
            await publisher.PublishAccountLockedAsync(userId, reason);
            logger.LogWarning("Phat hien spam, khoa tai khoan {UserId}: {Reason} (score={Score})", userId, reason, check.Score);
        }
        else
        {
            await publisher.PublishDeleteAccountSpamAsync(userId, reason);
            logger.LogWarning("Vi pham lap lai, xoa vinh vien tai khoan {UserId}: {Reason} (score={Score})", userId, reason, check.Score);
        }
    }
}
