using System.Text.Json;
using ChatService.Api.Endpoints;
using StackExchange.Redis;

namespace ChatService.Api.Services;

// Luu lich su khieu nai trong Redis, TTL 10 tieng KE TU TIN DAU TIEN (khong
// refresh moi tin nhan moi) - dung theo tai lieu roadmap muc 4.2
// (ComplaintSummary.expiresAt: "10 tieng ke tu tin dau tien"). Admin Service
// (Phase 4) doc/ghi vao CUNG key nay qua cac internal endpoint duoi day - key
// Redis dung chung, khong thuoc rieng Chat Service hay Admin Service.
public class ComplaintStore(IConnectionMultiplexer redis)
{
    private static readonly TimeSpan Ttl = TimeSpan.FromHours(10);
    private const string ActiveIndexKey = "complaints:active"; // Set<userId> - index de Admin liet ke, don dep lazy khi doc
    private readonly IDatabase _db = redis.GetDatabase();

    private static string Key(long userId) => $"complaint:{userId}";

    public async Task<List<ComplaintMessageResponse>> GetMessagesAsync(long userId)
    {
        var values = await _db.ListRangeAsync(Key(userId));
        return values
            .Select(v => JsonSerializer.Deserialize<ComplaintMessageResponse>((string)v!)!)
            .ToList();
    }

    public async Task AppendMessageAsync(long userId, ComplaintMessageResponse message)
    {
        var key = Key(userId);
        var exists = await _db.KeyExistsAsync(key);

        await _db.ListRightPushAsync(key, JsonSerializer.Serialize(message));
        if (!exists)
            await _db.KeyExpireAsync(key, Ttl);

        // Admin reply KHONG tinh la "tin dau tien" cho TTL (nguoi dung phai la
        // nguoi mo khieu nai truoc) - chi them vao index khi la user gui.
        if (!exists && message.SenderRole == "user")
            await _db.SetAddAsync(ActiveIndexKey, userId);
    }

    // Danh sach khieu nai dang con hieu luc - dung boi Admin Service
    // (GET /internal/complaints). Don dep lazy: neu key da het TTL, tu xoa
    // khoi index luon vi khong con du lieu de hien thi.
    public async Task<List<ComplaintSummary>> ListActiveAsync()
    {
        var userIds = await _db.SetMembersAsync(ActiveIndexKey);
        var result = new List<ComplaintSummary>();

        foreach (var idVal in userIds)
        {
            var userId = (long)idVal;
            var key = Key(userId);
            var ttl = await _db.KeyTimeToLiveAsync(key);
            if (ttl is null)
            {
                await _db.SetRemoveAsync(ActiveIndexKey, idVal);
                continue;
            }

            var last = await _db.ListGetByIndexAsync(key, -1);
            if (last.IsNullOrEmpty)
                continue;

            var lastMessage = JsonSerializer.Deserialize<ComplaintMessageResponse>((string)last!)!;
            result.Add(new ComplaintSummary(userId, lastMessage.CreatedAt, DateTimeOffset.UtcNow.Add(ttl.Value)));
        }

        return result;
    }
}
