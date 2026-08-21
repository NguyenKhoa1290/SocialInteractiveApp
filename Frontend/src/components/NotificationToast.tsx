import { useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { notificationApi } from "../api/notificationApi";
import { useNotificationStore } from "../store/notificationStore";
import type { AppNotification } from "../types/notification";
import "./notification-toast.css";

// 15 giay: du de doc va bam, nhung khong nam mai che man hinh. Cuoc hop va
// loi moi la thu can phan ung ngay, de lau hon cung khong con y nghia.
const AUTO_DISMISS_MS = 15000;

function Toast({ notification }: { notification: AppNotification }) {
  const navigate = useNavigate();
  const dismissToast = useNotificationStore((s) => s.dismissToast);
  const markReadLocal = useNotificationStore((s) => s.markRead);

  useEffect(() => {
    const timer = setTimeout(() => dismissToast(notification.id), AUTO_DISMISS_MS);
    return () => clearTimeout(timer);
  }, [notification.id, dismissToast]);

  function handleOpen() {
    dismissToast(notification.id);
    markReadLocal(notification.id);
    // Danh dau da doc o server la viec phu - khong bat nguoi dung cho no
    // xong moi duoc chuyen trang.
    notificationApi.markRead(notification.id).catch(() => {});
    if (notification.link) navigate(notification.link);
  }

  return (
    <div className="notif-toast" role="alert">
      <div className="notif-toast-body">
        <p className="notif-toast-title">{notification.title}</p>
        {notification.body && <p className="notif-toast-text">{notification.body}</p>}
      </div>
      <div className="notif-toast-actions">
        {notification.link && (
          <button className="notif-toast-open" onClick={handleOpen}>
            {notification.type === "meeting_started" || notification.type === "meeting_invite" ? "Gia nhập" : "Xem"}
          </button>
        )}
        <button
          className="notif-toast-close"
          onClick={() => dismissToast(notification.id)}
          aria-label="Đóng thông báo"
        >
          ×
        </button>
      </div>
    </div>
  );
}

// Popup cho cac thong bao co tinh khan (xem URGENT_TYPES). Dat trong AppShell
// nen no noi len du dang o man hinh nao - khac han the "Cuoc hop dang dien
// ra", von chi hien khi da o dung phong chat do.
export function NotificationToasts() {
  const toasts = useNotificationStore((s) => s.toasts);
  if (toasts.length === 0) return null;

  return (
    <div className="notif-toast-stack">
      {toasts.map((n) => (
        <Toast key={n.id} notification={n} />
      ))}
    </div>
  );
}
