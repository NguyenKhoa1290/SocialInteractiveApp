import { create } from "zustand";
import type { AppNotification } from "../types/notification";

interface NotificationState {
  items: AppNotification[];
  unreadCount: number;
  setItems: (items: AppNotification[]) => void;
  setUnreadCount: (count: number) => void;
  prepend: (n: AppNotification) => void;
  markRead: (id: number) => void;
  markAllRead: () => void;
  remove: (id: number) => void;
  clear: () => void;

  // Popup dang noi - tach rieng khoi items vi vong doi khac han: items song
  // toi khi nguoi dung xoa, con toast tu tat sau vai giay.
  toasts: AppNotification[];
  pushToast: (n: AppNotification) => void;
  dismissToast: (id: number) => void;
}

// Giu o store dung chung (khong phai state cua rieng trang Thong bao) vi so
// chua doc hien tren thanh dieu huong o MOI man hinh - thong bao toi luc dang
// xem chat cung phai lam con so do nhay len ngay.
export const useNotificationStore = create<NotificationState>((set) => ({
  items: [],
  unreadCount: 0,
  toasts: [],
  setItems: (items) => set({ items }),
  setUnreadCount: (unreadCount) => set({ unreadCount }),

  prepend: (n) =>
    set((s) => ({
      // Chan trung: SignalR co the giao lai cung mot thong bao sau khi ket
      // noi lai, va ban tu REST co the ve sau ban realtime.
      items: s.items.some((x) => x.id === n.id) ? s.items : [n, ...s.items],
      unreadCount: s.items.some((x) => x.id === n.id) ? s.unreadCount : s.unreadCount + 1,
    })),

  markRead: (id) =>
    set((s) => {
      const target = s.items.find((x) => x.id === id);
      // Bam lai thong bao da doc thi khong duoc tru so lan nua.
      if (!target || target.isRead) return s;
      return {
        items: s.items.map((x) => (x.id === id ? { ...x, isRead: true } : x)),
        unreadCount: Math.max(0, s.unreadCount - 1),
      };
    }),

  markAllRead: () =>
    set((s) => ({ items: s.items.map((x) => ({ ...x, isRead: true })), unreadCount: 0 })),

  remove: (id) =>
    set((s) => {
      const target = s.items.find((x) => x.id === id);
      return {
        items: s.items.filter((x) => x.id !== id),
        unreadCount: target && !target.isRead ? Math.max(0, s.unreadCount - 1) : s.unreadCount,
      };
    }),

  // Xep chong toi da 3 popup: nhieu hon thi che mat man hinh, va thong bao
  // cu nhat luc do cung sap tu tat roi.
  pushToast: (n) => set((s) => (s.toasts.some((x) => x.id === n.id) ? s : { toasts: [...s.toasts.slice(-2), n] })),

  dismissToast: (id) => set((s) => ({ toasts: s.toasts.filter((x) => x.id !== id) })),

  clear: () => set({ items: [], unreadCount: 0, toasts: [] }),
}));
