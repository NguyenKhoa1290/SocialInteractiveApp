namespace SpamTrackingService.Api.Models;

public enum AccountStatus
{
    Locked,
    Deleted
}

public class Violation
{
    public long Id { get; set; }
    public long UserId { get; set; }
    public DateTimeOffset DetectedAt { get; set; }
    public string Reason { get; set; } = string.Empty;
    public AccountStatus AccountStatus { get; set; } = AccountStatus.Locked;
    public int Score { get; set; }

    public static string StatusToString(AccountStatus s) => s == AccountStatus.Locked ? "locked" : "deleted";
    public static AccountStatus StatusFromString(string s) => s == "locked" ? AccountStatus.Locked : AccountStatus.Deleted;
}
