namespace ChatService.Api.Models;

public enum TopupRequestStatus
{
    Pending,
    Approved,
    Rejected
}

// Yeu cau nap them dung luong - Truong nhom gui, Admin duyet (xem
// chat-db-init.sql). Tach khoi luong tu-nap truc tiep cu.
public class StorageTopupRequest
{
    public long Id { get; set; }
    public long ConversationId { get; set; }
    public long RequestedBy { get; set; }
    public decimal Amount { get; set; }
    public TopupRequestStatus Status { get; set; } = TopupRequestStatus.Pending;
    public DateTimeOffset CreatedAt { get; set; }
    public DateTimeOffset? ResolvedAt { get; set; }
    public long? ResolvedBy { get; set; }

    public static string StatusToString(TopupRequestStatus s) =>
        s == TopupRequestStatus.Approved ? "approved" : s == TopupRequestStatus.Rejected ? "rejected" : "pending";

    public static TopupRequestStatus StatusFromString(string s) =>
        s == "approved" ? TopupRequestStatus.Approved : s == "rejected" ? TopupRequestStatus.Rejected : TopupRequestStatus.Pending;
}
