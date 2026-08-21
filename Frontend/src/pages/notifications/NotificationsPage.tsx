import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { notificationApi } from "../../api/notificationApi";
import { useNotificationStore } from "../../store/notificationStore";
import { extractApiError } from "../../lib/apiError";
import { AppShell } from "../../components/AppShell";
import type { AppNotification } from "../../types/notification";
import "./notifications.css";

// Nhan ngan theo loai, de nhin luot qua danh sach la phan biet duoc ngay
// mot loi moi hop voi mot canh bao dung luong.
const TYPE_LABEL: Record<string, string> = {
  account_locked: "Tài khoản",
  meeting_invite: "Cuộc họp",
  new_message: "Tin nhắn",
  storage_warning: "Dung lượng",
  member_left: "Nhóm",
  member_kicked: "Nhóm",
  workspace_dissolved: "Nhóm",
};

function timeAgo(iso: string): string {
  const diffMs = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diffMs / 60000);
  if (mins < 1) return "vừa xong";
  if (mins < 60) return `${mins} phút trước`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours} giờ trước`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days} ngày trước`;
  return new Date(iso).toLocaleDateString("vi-VN");
}

export function NotificationsPage() {
  const navigate = useNavigate();
  const items = useNotificationStore((s) => s.items);
  const unreadCount = useNotificationStore((s) => s.unreadCount);
  const setItems = useNotificationStore((s) => s.setItems);
  const setUnreadCount = useNotificationStore((s) => s.setUnreadCount);
  const markReadLocal = useNotificationStore((s) => s.markRead);
  const markAllReadLocal = useNotificationStore((s) => s.markAllRead);
  const removeLocal = useNotificationStore((s) => s.remove);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    Promise.all([notificationApi.list(), notificationApi.unreadCount()])
      .then(([listRes, countRes]) => {
        if (cancelled) return;
        setItems(listRes.data);
        setUnreadCount(countRes.data.count);
      })
      .catch((err) => {
        if (!cancelled) setError(extractApiError(err, "Không tải được thông báo"));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [setItems, setUnreadCount]);

  // Cap nhat giao dien TRUOC roi moi goi server: bam vao thong bao thi phai
  // nhay sang trang dich ngay, khong doi mot request danh dau da doc. Hong
  // request thi cung chi lech mot cai cham cho toi lan tai lai sau.
  async function handleOpen(n: AppNotification) {
    markReadLocal(n.id);
    notificationApi.markRead(n.id).catch(() => {});
    if (n.link) navigate(n.link);
  }

  async function handleMarkAll() {
    markAllReadLocal();
    try {
      await notificationApi.markAllRead();
    } catch (err) {
      setError(extractApiError(err, "Không đánh dấu được đã đọc"));
    }
  }

  async function handleRemove(e: React.MouseEvent, id: number) {
    e.stopPropagation(); // dung nut Xoa thi khong dong thoi mo thong bao
    removeLocal(id);
    try {
      await notificationApi.remove(id);
    } catch (err) {
      setError(extractApiError(err, "Không xoá được thông báo"));
    }
  }

  return (
    <AppShell>
      <div className="notif-page">
        <div className="notif-head">
          <h1>Thông báo</h1>
          {unreadCount > 0 && (
            <button className="notif-mark-all" onClick={handleMarkAll}>
              Đánh dấu tất cả đã đọc ({unreadCount})
            </button>
          )}
        </div>

        {error && <p className="ws-error">{error}</p>}

        {loading ? (
          <p className="notif-empty">Đang tải...</p>
        ) : items.length === 0 ? (
          <p className="notif-empty">Chưa có thông báo nào.</p>
        ) : (
          <ul className="notif-list">
            {items.map((n) => (
              <li
                key={n.id}
                className={`notif-item${n.isRead ? "" : " unread"}${n.link ? " clickable" : ""}`}
                onClick={() => handleOpen(n)}
              >
                <div className="notif-item-main">
                  <div className="notif-item-top">
                    <span className="notif-tag">{TYPE_LABEL[n.type] ?? "Khác"}</span>
                    <span className="notif-time">{timeAgo(n.createdAt)}</span>
                  </div>
                  <p className="notif-title">{n.title}</p>
                  {n.body && <p className="notif-body">{n.body}</p>}
                </div>
                <button className="notif-remove" onClick={(e) => handleRemove(e, n.id)} title="Xoá thông báo">
                  ×
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </AppShell>
  );
}
