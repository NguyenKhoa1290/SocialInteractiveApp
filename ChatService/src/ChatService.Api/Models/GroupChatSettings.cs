namespace ChatService.Api.Models;

public enum StoragePlan
{
    Free,
    Paid
}

public class GroupChatSettings
{
    public long ConversationId { get; set; }
    public StoragePlan Plan { get; set; } = StoragePlan.Free;
    public long StorageQuotaBytes { get; set; } = 2_147_483_648;
    public long StorageUsedBytes { get; set; }
    public bool IsLocked { get; set; }
    public DateTimeOffset? StorageExpiresAt { get; set; }
    public DateTimeOffset UpdatedAt { get; set; }

    // Them ngoai schema goc (chua co trong tai lieu roadmap) - can de theo
    // doi da gui canh bao o moc nao roi, tranh gui trung lap canh bao (xem
    // BackgroundServices/StorageWarningService.cs).
    public string? LastWarningStage { get; set; }

    public static string PlanToString(StoragePlan p) => p == StoragePlan.Free ? "free" : "paid";
    public static StoragePlan PlanFromString(string p) => p == "free" ? StoragePlan.Free : StoragePlan.Paid;
}
