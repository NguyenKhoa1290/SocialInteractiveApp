using System.Text.Json;
using StackExchange.Redis;

namespace ChatService.Api.Services;

// Snapshot cua 1 Message, du de dung lai xay MessageResponse (KHONG bao gom
// SenderDisplayName/RecipientEncryptedKey - 2 truong do luon tinh "live" du
// nguon la Redis hay Postgres, vi phu thuoc nguoi GOI hien tai, khong phai
// thuoc tinh co dinh cua tin nhan).
//
// ReplyToId them sau, dat cuoi va cho phep khuyet: JSON trong Redis khop theo
// TEN chu khong theo vi tri, nen cac ban ghi cu (khong co truong nay) van doc
// duoc binh thuong va nhan null. Tin cu trong cache vi the mat trich dan cho
// toi khi bi don, tin moi thi co ngay.
public record CachedMessage(
    long Id, long ConversationId, long? SenderId, string Type, string? Content,
    long? FileId, bool IsDeleted, DateTimeOffset CreatedAt, bool IsEncrypted, string? ContentNonce,
    bool IsEdited, DateTimeOffset? EditedAt, long? ReplyToId = null);

// Cache "nong" cho tin nhan gan day - dung theo tai lieu roadmap muc 6.1
// (Search Chat Service: "Redis cho du lieu nong, Postgres cho du lieu
// lanh"). Ghi qua WriteChatConsumerService (Kafka consumer, tach khoi write
// path chinh - dung dung nguyen tac "ghi Postgres truoc, publish event de
// dong bo Redis sau" da neu o muc 1 tai lieu roadmap). Gioi han: <=10.000
// tin/conversation VA <=10 ngay - qua 1 trong 2 nguong thi tu dong bi don,
// GET messages endpoint se tu fallback ve Postgres khi Redis khong du du
// lieu (xem ConversationEndpoints.cs).
public class ChatCacheService(IConnectionMultiplexer redis)
{
    private const int MaxMessagesPerConversation = 10_000;
    private static readonly TimeSpan MaxAge = TimeSpan.FromDays(10);

    // Han cho CHINH CAI KEY, khac voi MaxAge (han cho tung tin nhan ben trong).
    //
    // VI SAO CAN CA HAI: TrimAsync chi chay khi co tin nhan MOI trong hoi
    // thoai do. Mot nhom im lang thi khong bao gio bi don - da xac nhan tren
    // he thong dang chay: cac key chat:msg:* deu co TTL = -1, tuc nam lai
    // vinh vien. Nhieu hoi thoai ngu dong thi Redis phinh dan cho toi khi
    // cham gioi han 128Mi cua pod va bi k8s giet.
    //
    // Dat dai hon MaxAge mot chut: hoi thoai con hoat dong thi han duoc gia
    // han moi lan ghi, nen TTL nay chi thuc su cham vao hoi thoai da chet han.
    private static readonly TimeSpan KeyTtl = TimeSpan.FromDays(11);
    private readonly IDatabase _db = redis.GetDatabase();

    private static string HashKey(long conversationId) => $"chat:msg:{conversationId}";
    private static string IndexKey(long conversationId) => $"chat:msgidx:{conversationId}";

    public async Task CacheMessageAsync(CachedMessage message)
    {
        var hashKey = HashKey(message.ConversationId);
        var indexKey = IndexKey(message.ConversationId);
        var score = message.CreatedAt.ToUnixTimeMilliseconds();

        await _db.HashSetAsync(hashKey, message.Id.ToString(), JsonSerializer.Serialize(message));
        await _db.SortedSetAddAsync(indexKey, message.Id.ToString(), score);

        await TrimAsync(hashKey, indexKey);

        // Gia han moi lan ghi - hoi thoai con song thi key khong bao gio het
        // han, ngung hoat dong thi tu bien mat sau KeyTtl.
        await _db.KeyExpireAsync(hashKey, KeyTtl);
        await _db.KeyExpireAsync(indexKey, KeyTtl);
    }

    // Cap nhat tin nhan da co san trong cache (vd sau khi xoa mem) - chi
    // HSET de ghi de gia tri, KHONG dung ZADD lai (giu nguyen thu tu/score
    // cu, tranh phai biet lai CreatedAt goc).
    public async Task UpdateCachedMessageAsync(CachedMessage message)
    {
        if (await _db.KeyExistsAsync(HashKey(message.ConversationId)))
            await _db.HashSetAsync(HashKey(message.ConversationId), message.Id.ToString(), JsonSerializer.Serialize(message));
    }

    private async Task TrimAsync(string hashKey, string indexKey)
    {
        var count = await _db.SortedSetLengthAsync(indexKey);
        if (count > MaxMessagesPerConversation)
        {
            var overflow = count - MaxMessagesPerConversation;
            var victims = await _db.SortedSetRangeByRankAsync(indexKey, 0, overflow - 1);
            if (victims.Length > 0)
            {
                await _db.SortedSetRemoveRangeByRankAsync(indexKey, 0, overflow - 1);
                await _db.HashDeleteAsync(hashKey, Array.ConvertAll(victims, v => (RedisValue)v));
            }
        }

        var cutoff = DateTimeOffset.UtcNow.Subtract(MaxAge).ToUnixTimeMilliseconds();
        var oldVictims = await _db.SortedSetRangeByScoreAsync(indexKey, double.NegativeInfinity, cutoff);
        if (oldVictims.Length > 0)
        {
            await _db.SortedSetRemoveRangeByScoreAsync(indexKey, double.NegativeInfinity, cutoff);
            await _db.HashDeleteAsync(hashKey, Array.ConvertAll(oldVictims, v => (RedisValue)v));
        }
    }

    // Tra ve toi da "take" tin nhan gan nhat (truoc moc "before" neu co).
    // Neu tra ve IT HON "take" (cache chua du/da bi don), goi phia tren PHAI
    // tu fallback sang Postgres cho request nay - ham nay khong tu fallback,
    // chi phan anh dung nhung gi Redis dang co.
    public async Task<List<CachedMessage>> GetRecentAsync(long conversationId, DateTimeOffset? before, int take)
    {
        var indexKey = IndexKey(conversationId);
        var hashKey = HashKey(conversationId);

        var maxScore = before is null ? double.PositiveInfinity : before.Value.ToUnixTimeMilliseconds() - 1;
        var ids = await _db.SortedSetRangeByScoreAsync(indexKey, double.NegativeInfinity, maxScore, order: Order.Descending, take: take);
        if (ids.Length == 0)
            return [];

        var values = await _db.HashGetAsync(hashKey, Array.ConvertAll(ids, v => (RedisValue)v));
        var result = new List<CachedMessage>();
        foreach (var v in values)
        {
            if (v.IsNullOrEmpty)
                continue; // entry bi don khoi hash nhung con sot lai o index (hiem, do TrimAsync khong nguyen tu 100%)
            var msg = JsonSerializer.Deserialize<CachedMessage>((string)v!);
            if (msg is not null)
                result.Add(msg);
        }

        return [.. result.OrderByDescending(m => m.CreatedAt)];
    }
}
