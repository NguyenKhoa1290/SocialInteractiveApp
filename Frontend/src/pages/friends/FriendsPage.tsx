import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { friendApi } from "../../api/friendApi";
import { chatApi } from "../../api/chatApi";
import { extractApiError } from "../../lib/apiError";
import { AppShell } from "../../components/AppShell";
import type { AuthUser } from "../../types/auth";
import type { Friend, FriendRequest } from "../../types/friend";
import "./friends.css";

export function FriendsPage() {
  const navigate = useNavigate();
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<AuthUser[] | null>(null);
  const [incoming, setIncoming] = useState<FriendRequest[]>([]);
  const [outgoing, setOutgoing] = useState<FriendRequest[]>([]);
  const [friends, setFriends] = useState<Friend[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<number | null>(null);

  async function loadLists() {
    const [inc, out, fr] = await Promise.all([friendApi.incoming(), friendApi.outgoing(), friendApi.list()]);
    setIncoming(inc.data);
    setOutgoing(out.data);
    setFriends(fr.data);
  }

  useEffect(() => {
    loadLists().catch((err) => setError(extractApiError(err, "Không tải được danh sách bạn bè")));
  }, []);

  async function handleSearch(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      const { data } = await friendApi.searchUsers(query);
      setResults(data);
    } catch (err) {
      setError(extractApiError(err, "Tìm kiếm thất bại"));
    }
  }

  async function handleSendRequest(userId: number) {
    setBusyId(userId);
    setError(null);
    try {
      await friendApi.sendRequest(userId);
      await loadLists();
    } catch (err) {
      setError(extractApiError(err, "Không gửi được lời mời"));
    } finally {
      setBusyId(null);
    }
  }

  async function handleAccept(requestId: number) {
    setBusyId(requestId);
    try {
      await friendApi.accept(requestId);
      await loadLists();
    } catch (err) {
      setError(extractApiError(err, "Không chấp nhận được"));
    } finally {
      setBusyId(null);
    }
  }

  async function handleCancelOrReject(requestId: number) {
    setBusyId(requestId);
    try {
      await friendApi.cancelOrReject(requestId);
      await loadLists();
    } catch (err) {
      setError(extractApiError(err, "Không thực hiện được"));
    } finally {
      setBusyId(null);
    }
  }

  async function handleStartChat(userId: number) {
    setBusyId(userId);
    setError(null);
    try {
      const { data } = await chatApi.createOrGetP2P(userId);
      navigate(`/app/chat/${data.id}`);
    } catch (err) {
      setError(extractApiError(err, "Không mở được cuộc trò chuyện"));
    } finally {
      setBusyId(null);
    }
  }

  async function handleRemoveFriend(userId: number) {
    setBusyId(userId);
    try {
      await friendApi.remove(userId);
      await loadLists();
    } catch (err) {
      setError(extractApiError(err, "Không xoá được bạn"));
    } finally {
      setBusyId(null);
    }
  }

  const friendIds = new Set(friends.map((f) => f.userId));
  const outgoingIds = new Set(outgoing.map((r) => r.userId));

  return (
    <AppShell activeTab="chat">
      <h1>Bạn bè</h1>

      <form onSubmit={handleSearch} className="friend-search-form">
        <input
          className="friend-input"
          placeholder="Tìm theo nickname..."
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <button type="submit" className="friend-btn-primary">
          Tìm
        </button>
      </form>

      {error && <p className="friend-error">{error}</p>}

      {results !== null && (
        <div className="friend-section">
          <h2>Kết quả tìm kiếm</h2>
          {results.length === 0 && <p className="friend-empty">Không tìm thấy ai</p>}
          {results.map((u) => (
            <div key={u.id} className="friend-row">
              <span>{u.nickname}</span>
              {friendIds.has(u.id) ? (
                <span className="friend-badge">Đã là bạn bè</span>
              ) : outgoingIds.has(u.id) ? (
                <span className="friend-badge">Đã gửi lời mời</span>
              ) : (
                <button className="friend-btn-primary" disabled={busyId === u.id} onClick={() => handleSendRequest(u.id)}>
                  Kết bạn
                </button>
              )}
            </div>
          ))}
        </div>
      )}

      {incoming.length > 0 && (
        <div className="friend-section">
          <h2>Lời mời kết bạn ({incoming.length})</h2>
          {incoming.map((r) => (
            <div key={r.id} className="friend-row">
              <span>{r.nickname}</span>
              <div style={{ display: "flex", gap: 6 }}>
                <button className="friend-btn-primary" disabled={busyId === r.id} onClick={() => handleAccept(r.id)}>
                  Chấp nhận
                </button>
                <button className="friend-btn-secondary" disabled={busyId === r.id} onClick={() => handleCancelOrReject(r.id)}>
                  Từ chối
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="friend-section">
        <h2>Bạn bè ({friends.length})</h2>
        {friends.length === 0 && <p className="friend-empty">Chưa có ai trong danh sách bạn bè</p>}
        {friends.map((f) => (
          <div key={f.userId} className="friend-row">
            <span>{f.nickname}</span>
            <div style={{ display: "flex", gap: 6 }}>
              <button className="friend-btn-primary" disabled={busyId === f.userId} onClick={() => handleStartChat(f.userId)}>
                Nhắn tin
              </button>
              <button className="friend-btn-secondary" disabled={busyId === f.userId} onClick={() => handleRemoveFriend(f.userId)}>
                Xoá bạn
              </button>
            </div>
          </div>
        ))}
      </div>
    </AppShell>
  );
}
