using System.Collections.Concurrent;

namespace ChatService.Api.Services;

// Theo doi user nao dang online (>=1 ket noi WebSocket con mo) - luu trong
// bo nho tien trinh (khong phai Redis) vi Chat Service hien chi chay 1
// replica; can chuyen sang Redis (pub/sub) neu sau nay scale ngang nhieu
// replica cung luc, luc do 1 user co the noi vao 2 replica khac nhau.
public class PresenceTracker
{
    private readonly ConcurrentDictionary<long, HashSet<string>> _connections = new();
    private readonly object _lock = new();

    // Tra ve true neu day la ket noi DAU TIEN cua user (moi chuyen tu offline -> online)
    public bool AddConnection(long userId, string connectionId)
    {
        lock (_lock)
        {
            if (!_connections.TryGetValue(userId, out var set))
            {
                set = [];
                _connections[userId] = set;
            }
            var wasEmpty = set.Count == 0;
            set.Add(connectionId);
            return wasEmpty;
        }
    }

    // Tra ve true neu day la ket noi CUOI CUNG bi dong (user chuyen sang offline)
    public bool RemoveConnection(long userId, string connectionId)
    {
        lock (_lock)
        {
            if (!_connections.TryGetValue(userId, out var set))
                return false;

            set.Remove(connectionId);
            if (set.Count == 0)
            {
                _connections.TryRemove(userId, out _);
                return true;
            }
            return false;
        }
    }

    public bool IsOnline(long userId) => _connections.ContainsKey(userId);

    // ---- Ai dang MO man hinh cua tung cuoc tro chuyen ----
    //
    // Khac han IsOnline: mot nguoi co the dang online nhung o man hinh khac.
    // Dung de KHONG gui thong bao "co tin nhan moi" cho nguoi dang doc chinh
    // phong chat do - ho da thay tin nhan hien ra truoc mat qua SignalR roi,
    // them mot dong thong bao nua chi lam chuong bao keu vo nghia. Nhom dong
    // nguoi ma khong loc buoc nay thi moi tin nhan sinh ra mot thong bao cho
    // TUNG thanh vien.
    //
    // Khoa la (conversationId, userId) de mot nguoi mo hai tab van dem dung.
    private readonly ConcurrentDictionary<(long ConversationId, long UserId), HashSet<string>> _viewers = new();

    public void AddViewer(long conversationId, long userId, string connectionId)
    {
        lock (_lock)
        {
            var key = (conversationId, userId);
            if (!_viewers.TryGetValue(key, out var set))
            {
                set = [];
                _viewers[key] = set;
            }
            set.Add(connectionId);
        }
    }

    public void RemoveViewer(long conversationId, long userId, string connectionId)
    {
        lock (_lock)
        {
            var key = (conversationId, userId);
            if (!_viewers.TryGetValue(key, out var set))
                return;
            set.Remove(connectionId);
            if (set.Count == 0)
                _viewers.TryRemove(key, out _);
        }
    }

    // Dong tab dot ngot thi khong co LeaveConversation nao duoc goi - phai
    // don theo connectionId luc ngat, neu khong nguoi do bi coi la "dang xem"
    // vinh vien va se khong bao gio nhan duoc thong bao nua.
    public void RemoveViewerConnection(string connectionId)
    {
        lock (_lock)
        {
            foreach (var (key, set) in _viewers.ToArray())
            {
                if (!set.Remove(connectionId)) continue;
                if (set.Count == 0)
                    _viewers.TryRemove(key, out _);
            }
        }
    }

    public bool IsViewing(long conversationId, long userId) => _viewers.ContainsKey((conversationId, userId));

    public List<string> GetConnections(long userId) =>
        _connections.TryGetValue(userId, out var set) ? [.. set] : [];
}
