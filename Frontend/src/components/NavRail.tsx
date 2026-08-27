import { Link, useLocation } from "react-router-dom";
import { useAuthStore } from "../store/authStore";
import { useNotificationStore } from "../store/notificationStore";
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
};

export function NavRail() {
  const location = useLocation();
  const user = useAuthStore((s) => s.user);
  const unreadCount = useNotificationStore((s) => s.unreadCount);

  const items: Item[] = [
    { to: "/app", label: "Chat", icon: <IconChat />, match: (p) => p === "/app" || p.startsWith("/app/chat") },
    // Icon nay trong Figma TEN LA "Group" - la NHOM, khong phai Ban be. Viec
    // ket ban nam ngay trong panel trai cua man chat ca nhan.
    { to: "/app/groups", label: "Nhóm", icon: <IconFriends />, match: (p) => p.startsWith("/app/groups") },
    // Ban thiet ke goi day la "Mini App" va IPTV la mot muc BEN TRONG luoi do.
    // Man danh sach Mini App chua duoc dung nen tam tro thang toi IPTV - la
    // mini app duy nhat dang co that.
    { to: "/app/iptv", label: "Mini App", icon: <IconGrid />, match: (p) => p === "/app/iptv" },
  ];

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
            className={`rail-item${it.match(location.pathname) ? " active" : ""}`}
            aria-label={it.label}
            aria-current={it.match(location.pathname) ? "page" : undefined}
          >
            {it.icon}
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
