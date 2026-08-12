import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { chatApi } from "../../api/chatApi";
import { friendApi } from "../../api/friendApi";
import { workspaceApi } from "../../api/workspaceApi";
import { extractApiError } from "../../lib/apiError";
import { AppShell } from "../../components/AppShell";
import type { ConversationSummary } from "../../types/chat";
import "./chat.css";

export function ChatListPage() {
  const navigate = useNavigate();
  const [items, setItems] = useState<ConversationSummary[] | null>(null);
  const [names, setNames] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function load() {
      try {
        const [convRes, friendsRes, workspacesRes] = await Promise.all([
          chatApi.listConversations(),
          friendApi.list(),
          workspaceApi.listMine(),
        ]);

        // Chat Service khong resolve nickname/ten workspace (xem
        // ConversationSummaryResponse) - Frontend tu doi chieu voi 2 danh
        // sach da co san tu F1/F1.5.
        const nameMap: Record<string, string> = {};
        for (const f of friendsRes.data) nameMap[`u${f.userId}`] = f.nickname;
        for (const w of workspacesRes.data) nameMap[`w${w.id}`] = w.name;
        setNames(nameMap);
        setItems(convRes.data);
      } catch (err) {
        setError(extractApiError(err, "Không tải được danh sách hội thoại"));
      }
    }
    load();
  }, []);

  function displayName(c: ConversationSummary) {
    if (c.type === "p2p") return names[`u${c.otherUserId}`] ?? `User ${c.otherUserId}`;
    return names[`w${c.workspaceId}`] ?? `Nhóm ${c.workspaceId}`;
  }

  return (
    <AppShell>
      <h1>Chat</h1>
      {error && <p className="chat-error">{error}</p>}

      {items === null && !error && <p>Đang tải...</p>}
      {items !== null && items.length === 0 && (
        <p className="chat-empty">
          Chưa có cuộc trò chuyện nào. Sang tab "Bạn bè" và bấm "Nhắn tin" để bắt đầu.
        </p>
      )}

      <div className="chat-list">
        {items?.map((c) => (
          <div key={c.id} className="chat-list-item" onClick={() => navigate(`/app/chat/${c.id}`)}>
            <div className="chat-avatar">{displayName(c).charAt(0).toUpperCase()}</div>
            <div>
              <div className="chat-item-name">{displayName(c)}</div>
              <div className="chat-item-sub">{c.type === "group" ? "Nhóm" : "Trò chuyện 1-1"}</div>
            </div>
          </div>
        ))}
      </div>
    </AppShell>
  );
}
