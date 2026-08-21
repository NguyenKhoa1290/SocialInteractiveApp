namespace IdentityService.Api.Models;

// Cac loai thong bao dang co. Luu duoi dang chuoi trong CSDL (khong phai so)
// de doc log/query tay hieu ngay, va them loai moi khong lam lech du lieu cu.
public static class NotificationType
{
    public const string AccountLocked = "account_locked";
    public const string MeetingInvite = "meeting_invite";
    public const string MeetingStarted = "meeting_started";
    public const string NewMessage = "new_message";
    public const string StorageWarning = "storage_warning";
    public const string MemberLeft = "member_left";
    public const string MemberKicked = "member_kicked";
    public const string WorkspaceDissolved = "workspace_dissolved";
}

// Identity Service la dau moi notification cua ca he thong - xem ghi chu day
// du o identity-db-init.sql.
public class Notification
{
    public long Id { get; set; }
    public long UserId { get; set; }
    public string Type { get; set; } = string.Empty;
    public string Title { get; set; } = string.Empty;
    public string? Body { get; set; }

    // Duong dan trong Frontend de bam vao thong bao la nhay toi dung cho.
    public string? Link { get; set; }

    public bool IsRead { get; set; }
    public DateTimeOffset CreatedAt { get; set; }
}
