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

    public List<string> GetConnections(long userId) =>
        _connections.TryGetValue(userId, out var set) ? [.. set] : [];
}
