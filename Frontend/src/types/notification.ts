export type NotificationType =
  | "account_locked"
  | "meeting_invite"
  | "new_message"
  | "storage_warning"
  | "member_left"
  | "member_kicked"
  | "workspace_dissolved";

// Hinh dang nay dung CHUNG cho ca REST lan WebSocket - Identity Service tra
// ve cung mot kieu o ca hai duong (xem NotificationService.cs).
export interface AppNotification {
  id: number;
  type: NotificationType;
  title: string;
  body: string | null;
  // Duong dan trong app de bam vao thong bao la nhay toi dung cho.
  link: string | null;
  isRead: boolean;
  createdAt: string;
}
