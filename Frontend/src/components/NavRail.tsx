import { Link, useLocation } from "react-router-dom";
import { useAuthStore } from "../store/authStore";
import { useNotificationStore } from "../store/notificationStore";
import { useChatUnreadStore } from "../store/chatUnreadStore";
import { IconBell, IconChat, IconFriends, IconGear, IconGrid } from "./RailIcons";
import { Avatar } from "./Avatar";

// Thanh dieu huong doc - vo chung cua ban thiet ke Calli.
//
// Thay cho dock 6 tab duoi day. Ban thiet ke chi co 4 muc + avatar, nen hai
// muc cu phai di dau do:
//   - "Nhom" bo khoi thanh dieu huong. Khong mat gi: ChatListPage VON DA liet
//     ke ca chat 1-1 lan nhom (xem displayName), con phan QUAN LY nhom di vao
//     menu banh rang.
//   - "Thong bao" thanh chuong co huy hieu, dat canh avatar tren dinh.
//
// Banh rang DAN THANG sang man "Thong tin" (/app/profile) chu khong mo menu
// tha xuong. Ban dau toi tu bay ra mot menu; ban thiet ke ve han mot MAN RIENG
// cho viec do (Figma node 111:589: anh dai dien, ten, "Dang xuat", "Che do
// quan tri") - di theo thiet ke thi bot mot lop tuong tac va it cho de lech.
//
// Tren man hep, chinh thanh nay nam ngang duoi day (xem app-shell.css) - mot
// bo danh dau, hai hinh dang, khong phai hai component song song de lech nhau.
type Item = {
  to: string;
  label: string;
  icon: React.ReactNode;
  match: (p: string) => boolean;
  key: RailTab;
};

// Muc dang mo, khi duong dan KHONG du de suy ra.
//
// Chat nhom va chat ca nhan dung chung mot duong dan (/app/chat/:id) - nhin
// vao duong dan thi khong the biet dang o muc nao, va truoc day thanh dieu
// huong doan la "Chat", nen mo mot nhom la den sang nhay tu Nhom sang Chat.
// Trang nao biet cau tra loi thi tu khai ra.
export type RailTab = "chat" | "groups" | "miniapp";

export function NavRail({ activeTab }: { activeTab?: RailTab }) {
  const location = useLocation();
  const user = useAuthStore((s) => s.user);
  const unreadCount = useNotificationStore((s) => s.unreadCount);
  // Cham do "tin moi": p2p -> bieu tuong Chat, nhom -> bieu tuong Nhom. Chua
  // biet loai (chua nap danh sach) thi coi la p2p (Chat).
  const chuaP2P = useChatUnreadStore((s) =>
    Object.keys(s.unread).some((id) => (s.types[Number(id)] ?? "p2p") === "p2p"),
  );
  const chuaGroup = useChatUnreadStore((s) =>
    Object.keys(s.unread).some((id) => s.types[Number(id)] === "group"),
  );

  const items: Item[] = [
    { key: "chat", to: "/app", label: "Chat", icon: <IconChat />, match: (p) => p === "/app" || p.startsWith("/app/chat") },
    // Icon nay trong Figma TEN LA "Group" - la NHOM, khong phai Ban be. Viec
    // ket ban nam ngay trong panel trai cua man chat ca nhan.
    { key: "groups", to: "/app/groups", label: "Nhóm", icon: <IconFriends />, match: (p) => p.startsWith("/app/groups") },
    // Ban thiet ke goi day la "Mini App" va IPTV la mot muc BEN TRONG luoi do.
    // Man danh sach Mini App chua duoc dung nen tam tro thang toi IPTV - la
    // mini app duy nhat dang co that.
    { key: "miniapp", to: "/app/iptv", label: "Mini App", icon: <IconGrid />, match: (p) => p === "/app/iptv" },
  ];

  // Trang tu khai thi tin trang; khong khai thi moi suy tu duong dan.
  const dangMo = (it: Item) => (activeTab ? it.key === activeTab : it.match(location.pathname));

  return (
    <nav className="rail" aria-label="Điều hướng chính">
      <div className="rail-top">
        <Link
          to="/app/profile"
          className={`rail-avatar${location.pathname === "/app/profile" ? " active" : ""}`}
          aria-label={`Trang cá nhân của ${user?.nickname ?? "bạn"}`}
          title={user?.nickname ?? "Cá nhân"}
        >
          <Avatar
            userId={user?.id ?? 0}
            nickname={user?.nickname}
            avatarUpdatedAt={user?.avatarUpdatedAt}
            size={48}
          />
        </Link>

        <Link
          to="/app/notifications"
          className={`rail-item rail-bell${location.pathname === "/app/notifications" ? " active" : ""}`}
          aria-label={unreadCount > 0 ? `Thông báo, ${unreadCount} chưa đọc` : "Thông báo"}
        >
          <IconBell />
          {unreadCount > 0 && (
            // Qua 99 thi con so chinh xac khong con y nghia, chi lam vo o.
            <span className="rail-badge">{unreadCount > 99 ? "99+" : unreadCount}</span>
          )}
          <span className="rail-label">Thông báo</span>
        </Link>
      </div>

      <div className="rail-mid">
        {items.map((it) => (
          <Link
            key={it.to}
            to={it.to}
            className={`rail-item${dangMo(it) ? " active" : ""}`}
            aria-label={
              (it.key === "chat" && chuaP2P) || (it.key === "groups" && chuaGroup)
                ? `${it.label}, có tin nhắn mới`
                : it.label
            }
            aria-current={dangMo(it) ? "page" : undefined}
          >
            {it.icon}
            {((it.key === "chat" && chuaP2P) || (it.key === "groups" && chuaGroup)) && (
              <span className="rail-dot" aria-hidden="true" />
            )}
            <span className="rail-label">{it.label}</span>
          </Link>
        ))}
      </div>

      <div className="rail-bottom">
        <Link
          to="/app/profile"
          className={`rail-item rail-gear${location.pathname === "/app/profile" ? " active" : ""}`}
          aria-label="Cài đặt"
          aria-current={location.pathname === "/app/profile" ? "page" : undefined}
        >
          <IconGear />
          <span className="rail-label">Cài đặt</span>
        </Link>
      </div>
    </nav>
  );
}
