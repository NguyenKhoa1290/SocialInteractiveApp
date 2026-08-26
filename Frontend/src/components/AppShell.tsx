import { useEffect } from "react";
import type { ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import { authApi } from "../api/authApi";
import { useAuthStore } from "../store/authStore";
import { useKeyStore } from "../store/keyStore";
import { stopTokenRefresh } from "../lib/tokenScheduler";
import { clearPersistedKey } from "../lib/crypto/keyPersistence";
import { onNotification, stopNotificationHub } from "../lib/notificationHub";
import { notificationApi } from "../api/notificationApi";
import { useNotificationStore } from "../store/notificationStore";
import { URGENT_TYPES } from "../types/notification";
import { NavRail } from "./NavRail";
import { NotificationToasts } from "./NotificationToast";
import "./app-shell.css";

export function AppShell({ children }: { children: ReactNode }) {
  const navigate = useNavigate();
  const accessToken = useAuthStore((s) => s.accessToken);
  const clearAuth = useAuthStore((s) => s.clearAuth);

  // Dat o AppShell chu khong o trang Thong bao: thong bao phai toi du dang o
  // man hinh nao, va con so chua doc hien tren thanh dieu huong o khap noi.
  useEffect(() => {
    if (!accessToken) return;
    let unsubscribe: (() => void) | undefined;
    let cancelled = false;

    notificationApi
      .unreadCount()
      .then((res) => {
        if (!cancelled) useNotificationStore.getState().setUnreadCount(res.data.count);
      })
      .catch(() => {
        // Chuong bao khong len duoc thi ca app van dung binh thuong - khong
        // dang de chen mot bao loi vao moi man hinh.
      });

    onNotification((n) => {
      useNotificationStore.getState().prepend(n);
      // Chi loai khan moi noi popup - tin nhan moi va canh bao dung luong
      // den lien tuc, popup se thanh phien nhieu.
      if (URGENT_TYPES.includes(n.type)) useNotificationStore.getState().pushToast(n);
    })
      .then((off) => {
        // Component da thao truoc khi ket noi kip mo -> huy dang ky ngay,
        // neu khong handler se song mai va lam so chua doc nhay lung tung.
        if (cancelled) off();
        else unsubscribe = off;
      })
      .catch(() => {});

    return () => {
      cancelled = true;
      unsubscribe?.();
    };
  }, [accessToken]);

  async function handleLogout() {
    try {
      await authApi.logout();
    } catch {
      // token co the da het han - van cho logout phia client binh thuong
    }
    stopTokenRefresh();
    clearAuth();
    clearPersistedKey();
    useKeyStore.getState().clearKeys();
    // Khong dong hub thi ket noi cu van giu JWT cu va tiep tuc nhan thong
    // bao cua tai khoan vua thoat - nguoi dang nhap sau se thay chung.
    await stopNotificationHub();
    useNotificationStore.getState().clear();
    navigate("/login");
  }

  // Khong con thanh header rieng: ban thiet ke gom het thuong hieu, avatar
  // va loi vao quan tri vao thanh doc ben trai, danh toan bo chieu cao con
  // lai cho noi dung.
  return (
    <div className="shell">
      <NavRail onLogout={handleLogout} />
      <main className="shell-main">{children}</main>
      <NotificationToasts />
    </div>
  );
}
