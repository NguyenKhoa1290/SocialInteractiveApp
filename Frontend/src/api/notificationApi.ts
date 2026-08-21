import { identityHttp } from "./httpClient";
import type { AppNotification } from "../types/notification";

// Thong bao nam o Identity Service chu khong phai service sinh ra su kien:
// tai lieu thiet ke dat Identity lam dau moi notification cua ca he thong,
// moi service khac publish qua RabbitMQ toi do.
export const notificationApi = {
  list: (unreadOnly = false, limit = 50) =>
    identityHttp.get<AppNotification[]>("/notifications", { params: { unreadOnly, limit } }),

  unreadCount: () => identityHttp.get<{ count: number }>("/notifications/unread-count"),

  markRead: (id: number) => identityHttp.post<void>(`/notifications/${id}/read`),

  markAllRead: () => identityHttp.post<void>("/notifications/read-all"),

  remove: (id: number) => identityHttp.delete<void>(`/notifications/${id}`),
};
