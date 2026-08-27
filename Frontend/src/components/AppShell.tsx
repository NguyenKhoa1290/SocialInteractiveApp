import { useEffect } from "react";
import type { ReactNode } from "react";
import { useAuthStore } from "../store/authStore";
import { onNotification } from "../lib/notificationHub";
import { notificationApi } from "../api/notificationApi";
import { useNotificationStore } from "../store/notificationStore";
import { URGENT_TYPES } from "../types/notification";
import { NavRail } from "./NavRail";
import { NotificationToasts } from "./NotificationToast";
import "./app-shell.css";

export function AppShell({ children }: { children: ReactNode }) {
  const accessToken = useAuthStore((s) => s.accessToken);

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

  return (
    <div className="shell">
      <NavRail />
      <main className="shell-main">{children}</main>
      <NotificationToasts />
    </div>
  );
}
