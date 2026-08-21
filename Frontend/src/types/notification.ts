export type NotificationType =
  | "account_locked"
  | "meeting_invite"
  | "meeting_started"
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

// Loai thong bao co tinh KHAN - noi len popup thay vi chi tang so tren
// chuong. Doc muon 10 phut la mat y nghia: cuoc hop da tan, loi moi het han.
// Tin nhan moi va canh bao dung luong CO Y khong nam trong day - chung den
// lien tuc, popup se thanh phien nhieu.
export const URGENT_TYPES: NotificationType[] = ["meeting_started", "meeting_invite", "account_locked"];
