using System.Security.Cryptography;
using System.Text;
using System.Text.RegularExpressions;
using StackExchange.Redis;

namespace SpamTrackingService.Api.Services;

public class SpamDetectionOptions
{
    // Tin so 1: tan suat - qua N tin/60s tu 1 user (bat ke conversation nao) -> cong diem
    public int RateWindowSeconds { get; set; } = 60;
    public int RateThresholdMessages { get; set; } = 20;
    public int RateScore { get; set; } = 40;

    // Tin hieu 2: noi dung lap lai - cung 1 noi dung (hash) gui >= K lan trong
    // window -> cong diem. Spam "copy-paste" hang loat la pattern rat pho bien.
    public int DuplicateWindowSeconds { get; set; } = 120;
    public int DuplicateThresholdCount { get; set; } = 4;
    public int DuplicateScore { get; set; } = 40;

    // Tin hieu 3: tu khoa/pattern nghi ngo (link quang cao, cum tu spam pho bien)
    public int KeywordScore { get; set; } = 30;

    // Tong diem >= nguong nay moi ghi nhan vi pham - ket hop nhieu tin hieu yeu
    // se dang tin cay hon 1 tin hieu manh don le (giam false positive).
    public int ViolationThreshold { get; set; } = 60;
}

public record SpamCheckResult(bool IsViolation, int Score, List<string> Reasons);

// Ket hop 3 tin hieu (tan suat + noi dung lap + tu khoa) thanh 1 diem so tong
// hop - thuat toan/nguong CHUA duoc dac ta chi tiet trong tai lieu roadmap
// goc (UC-38, ghi chu "diem mo"), day la de xuat rieng, de chinh lai qua
// SpamDetectionOptions khi co du lieu that de hieu chinh nguong.
public class SpamDetector(IConnectionMultiplexer redis, SpamDetectionOptions options)
{
    private readonly IDatabase _db = redis.GetDatabase();

    // Danh sach tu khoa/pattern spam co ban - mo rong dan theo thuc te, khong
    // co trong tai lieu goc (tu de xuat).
    private static readonly Regex[] SpamPatterns =
    [
        new Regex(@"\b(click here|free money|make money fast|earn \$\d+)\b", RegexOptions.IgnoreCase | RegexOptions.Compiled),
        new Regex(@"(https?://)?(bit\.ly|tinyurl\.com|t\.me)/\S+", RegexOptions.IgnoreCase | RegexOptions.Compiled),
        new Regex(@"\b(mua ngay|khuyen mai soc|giam gia \d+%|vay tien nhanh)\b", RegexOptions.IgnoreCase | RegexOptions.Compiled),
    ];

    public async Task<SpamCheckResult> CheckAsync(long userId, string? content)
    {
        var score = 0;
        var reasons = new List<string>();

        // --- Tin hieu 1: tan suat ---
        var rateKey = $"spam:rate:{userId}";
        var rateCount = await _db.StringIncrementAsync(rateKey);
        if (rateCount == 1)
            await _db.KeyExpireAsync(rateKey, TimeSpan.FromSeconds(options.RateWindowSeconds));

        if (rateCount >= options.RateThresholdMessages)
        {
            score += options.RateScore;
            reasons.Add($"Gui {rateCount} tin nhan trong {options.RateWindowSeconds}s (nguong: {options.RateThresholdMessages})");
        }

        // --- Tin hieu 2 + 3: noi dung lap lai + tu khoa ---
        // Chat Service (Phase E2EE, tu de xuat) gui Content=null cho tin nhan
        // Text da ma hoa client-side (server khong con thay plaintext) - 2
        // tin hieu nay tu dong bi bo qua (khong sai/khong crash), chi con
        // tin hieu 1 (tan suat) hoat dong voi tin nhan Text. Danh doi da duoc
        // xac nhan chap nhan - xem Congviec/... muc 8.3.
        if (!string.IsNullOrWhiteSpace(content))
        {
            var contentHash = Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(content.Trim().ToLowerInvariant())));
            var dupKey = $"spam:dup:{userId}:{contentHash}";
            var dupCount = await _db.StringIncrementAsync(dupKey);
            if (dupCount == 1)
                await _db.KeyExpireAsync(dupKey, TimeSpan.FromSeconds(options.DuplicateWindowSeconds));

            if (dupCount >= options.DuplicateThresholdCount)
            {
                score += options.DuplicateScore;
                reasons.Add($"Gui trung noi dung {dupCount} lan trong {options.DuplicateWindowSeconds}s");
            }

            // --- Tin hieu 3: tu khoa/pattern ---
            if (Array.Exists(SpamPatterns, p => p.IsMatch(content)))
            {
                score += options.KeywordScore;
                reasons.Add("Noi dung khop pattern spam/quang cao nghi ngo");
            }
        }

        return new SpamCheckResult(score >= options.ViolationThreshold, score, reasons);
    }
}
