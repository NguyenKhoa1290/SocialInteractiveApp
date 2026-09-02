import { create } from "zustand";

// Trang thai "tin nhan moi chua doc" cho danh sach hoi thoai, tinh RIENG o
// client trong phien nay - server chua co mo hinh trang thai da doc theo tung
// nguoi. Dung cho: cham do canh avatar + tren bieu tuong Chat, va dua nguoi
// vua nhan tin len dau danh sach.
//
// Nguon tin: thong bao "new_message" da toi san qua notificationHub (AppShell
// nghe san), nen KHONG can join tung group SignalR. Thong bao chi gui cho
// nguoi NHAN (khong gui cho nguoi gui) nen khong phai loc tin cua chinh minh.
interface ChatUnreadState {
  // Hoi thoai dang mo - khong danh dau chua doc cho no.
  activeId: number | null;
  // convId -> co tin chua doc.
  unread: Record<number, true>;
  // convId -> moc thoi gian hoat dong gan nhat (ms) do tin realtime dua toi,
  // de sap xep "moi nhat len dau" ngay trong phien ma khong doi tai lai.
  activity: Record<number, number>;
  // convId -> loai hoi thoai, de dat cham do dung bieu tuong (Chat vs Nhom).
  // Thong bao new_message khong noi loai, nen phai tra cuu qua ban do nay do
  // danh sach hoi thoai nap len. Chua biet loai thi coi la "p2p" (icon Chat).
  types: Record<number, "p2p" | "group">;

  // Mo mot hoi thoai: xoa cham chua doc cua no, ghi lam hoi thoai dang xem.
  setActive: (id: number | null) => void;
  // Co tin moi toi cho mot hoi thoai (tu nguoi khac).
  incoming: (conversationId: number, ts: number) => void;
  // Ghi nho loai cua cac hoi thoai (goi khi nap danh sach hoi thoai).
  setTypes: (convs: { id: number; type: "p2p" | "group" }[]) => void;
}

export const useChatUnreadStore = create<ChatUnreadState>((set) => ({
  activeId: null,
  unread: {},
  activity: {},
  types: {},

  setActive: (id) =>
    set((s) => {
      if (id == null) return { activeId: null };
      if (!s.unread[id]) return { activeId: id };
      const u = { ...s.unread };
      delete u[id];
      return { activeId: id, unread: u };
    }),

  incoming: (conversationId, ts) =>
    set((s) => {
      const activity = {
        ...s.activity,
        [conversationId]: Math.max(ts || 0, s.activity[conversationId] ?? 0),
      };
      // Dang mo chinh hoi thoai do thi coi nhu da doc - chi cap nhat thu tu.
      if (conversationId === s.activeId) return { activity };
      return { activity, unread: { ...s.unread, [conversationId]: true } };
    }),

  setTypes: (convs) =>
    set((s) => {
      const types = { ...s.types };
      for (const c of convs) types[c.id] = c.type;
      return { types };
    }),
}));
