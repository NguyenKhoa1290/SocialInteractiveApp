import type { Message } from "../types/chat";

// Messenger khong lap thoi gian cho tung tin. Mot khoang nghi dang ke se mo
// mot doan hoi thoai moi, kem moc gio o giua danh sach va ten nguoi gui lai.
// 15 phut du de tach hai luot chat ma khong lam lich su bi day dac timestamp.
export const CHAT_TIMELINE_GAP_MS = 15 * 60 * 1000;

function validTime(value: string) {
  const time = Date.parse(value);
  return Number.isFinite(time) ? time : null;
}

function khacNgay(a: number, b: number) {
  const first = new Date(a);
  const second = new Date(b);
  return first.getFullYear() !== second.getFullYear() ||
    first.getMonth() !== second.getMonth() ||
    first.getDate() !== second.getDate();
}

export function shouldShowChatTimeSeparator(current: Pick<Message, "createdAt">, previous?: Pick<Message, "createdAt">) {
  if (!previous) return true;

  const currentTime = validTime(current.createdAt);
  const previousTime = validTime(previous.createdAt);
  if (currentTime === null || previousTime === null) return false;

  return khacNgay(currentTime, previousTime) || currentTime - previousTime >= CHAT_TIMELINE_GAP_MS;
}

export function shouldShowChatSender(
  current: Pick<Message, "senderId" | "createdAt">,
  previous: Pick<Message, "senderId" | "createdAt"> | undefined,
  currentUserId: number | undefined,
) {
  if (current.senderId === currentUserId) return false;
  return !previous || current.senderId !== previous.senderId || shouldShowChatTimeSeparator(current, previous);
}

export function formatChatTimeSeparator(createdAt: string) {
  const time = validTime(createdAt);
  if (time === null) return "";

  const date = new Date(time);
  const gio = date.toLocaleTimeString("vi-VN", { hour: "2-digit", minute: "2-digit" });
  const now = new Date();
  return khacNgay(time, now.getTime())
    ? `${gio} · ${date.toLocaleDateString("vi-VN")}`
    : gio;
}
