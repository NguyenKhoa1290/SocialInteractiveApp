using Confluent.Kafka;
using Confluent.Kafka.Admin;


namespace SpamTrackingService.Api.BackgroundServices;

// Tao san topic Kafka luc service khoi dong.
//
// VI SAO CAN: truoc day khong noi nao tao topic ca - chung "moc len" tinh co
// khi co producer day tin dau tien (broker dat auto.create.topics.enable=true).
// Hau qua that da gap tren cum k3s: cum moi dung len, chua ai gui tin nhan
// nao -> topic 'chat.service-log' chua ton tai -> SpamTracking subscribe vao
// mot topic khong co that va NAM IM khong bao loi (Confluent .NET dat
// allow.auto.create.topics = false o phia consumer), nen tinh nang chan spam
// chet am tham. Tao chu dong o day thi topic co mat truoc moi consumer,
// khong phu thuoc vao viec ai do tinh co gui tin nhan truoc.
//
// Chay lai bao nhieu lan cung duoc: topic da co thi broker tra
// TopicAlreadyExists va coi nhu xong. Nho vay Kafka co bi xoa sach du lieu
// hay dung lai tu dau thi chi can service khoi dong lai la topic tro ve.
public class KafkaTopicInitializer(KafkaOptions options, ILogger<KafkaTopicInitializer> logger) : BackgroundService
{
    private static readonly TimeSpan RetryDelay = TimeSpan.FromSeconds(10);
    private const int Partitions = 1;          // dung 1 broker duy nhat
    private const short ReplicationFactor = 1; // khong co broker thu hai de nhan ban

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        var topics = new[] { options.ChatLogTopic, options.ErrorLogTopic }.Distinct().ToList();
        var specs = topics.Select(t => new TopicSpecification
        {
            Name = t,
            NumPartitions = Partitions,
            ReplicationFactor = ReplicationFactor,
        }).ToList();

        using var admin = new AdminClientBuilder(
            new AdminClientConfig { BootstrapServers = options.BootstrapServers }).Build();

        while (!stoppingToken.IsCancellationRequested)
        {
            try
            {
                await admin.CreateTopicsAsync(specs, new CreateTopicsOptions { RequestTimeout = TimeSpan.FromSeconds(15) });
                logger.LogInformation("Da tao topic Kafka: {Topics}", string.Join(", ", topics));
                return;
            }
            catch (CreateTopicsException ex)
            {
                // CreateTopicsAsync nem exception cho CA LO ngay ca khi chi 1
                // topic trung ten - phai soi tung ket qua moi biet that su
                // hong hay chi la "da co san".
                var failed = ex.Results
                    .Where(r => r.Error.IsError && r.Error.Code != ErrorCode.TopicAlreadyExists)
                    .ToList();
                if (failed.Count == 0)
                {
                    logger.LogInformation("Topic Kafka da san sang: {Topics}", string.Join(", ", topics));
                    return;
                }
                logger.LogWarning("Khong tao duoc topic {Topics}: {Reasons} - thu lai sau {Delay}s",
                    string.Join(", ", failed.Select(f => f.Topic)),
                    string.Join("; ", failed.Select(f => f.Error.Reason)),
                    RetryDelay.TotalSeconds);
            }
            catch (Exception ex)
            {
                // Thuong la Kafka chua kip len (k8s khong dam bao thu tu khoi
                // dong) - khong lam service chet, cu doi roi thu lai.
                logger.LogWarning(ex, "Chua ket noi duoc Kafka de tao topic - thu lai sau {Delay}s", RetryDelay.TotalSeconds);
            }

            try
            {
                await Task.Delay(RetryDelay, stoppingToken);
            }
            catch (OperationCanceledException)
            {
                return;
            }
        }
    }
}
