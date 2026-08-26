import { useEffect, useRef, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { useAuthStore } from "../store/authStore";
import { useNotificationStore } from "../store/notificationStore";
import { decodeJwtIsAdmin } from "../lib/jwt";
import { IconBell, IconChat, IconFriends, IconGear, IconGrid } from "./RailIcons";

// Thanh dieu huong doc - vo chung cua ban thiet ke Calli.
//
// Thay cho dock 6 tab duoi day. Ban thiet ke chi co 4 muc + avatar, nen hai
// muc cu phai di dau do:
//   - "Nhom" bo khoi thanh dieu huong. Khong mat gi: ChatListPage VON DA liet
//     ke ca chat 1-1 lan nhom (xem displayName), con phan QUAN LY nhom di vao
//     menu banh rang.
//   - "Thong bao" thanh chuong co huy hieu, dat canh avatar tren dinh.
//
// Tren man hep, chinh thanh nay nam ngang duoi day (xem app-shell.css) - mot
// bo danh dau, hai hinh dang, khong phai hai component song song de lech nhau.
type Item = {
  to: string;
  label: string;
  icon: React.ReactNode;
  match: (p: string) => boolean;
};

export function NavRail({ onLogout }: { onLogout: () => void }) {
  const location = useLocation();
  const navigate = useNavigate();
  const user = useAuthStore((s) => s.user);
  const accessToken = useAuthStore((s) => s.accessToken);
  const unreadCount = useNotificationStore((s) => s.unreadCount);
  const isAdmin = accessToken !== null && decodeJwtIsAdmin(accessToken);

  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement | null>(null);

  // Bam ra ngoai hoac bam Esc thi dong menu. Thieu cai nay thi menu dinh lai
  // tren man hinh va che mat noi dung ben duoi.
  useEffect(() => {
    if (!menuOpen) return;
    const onDown = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setMenuOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [menuOpen]);

  const items: Item[] = [
    { to: "/app", label: "Chat", icon: <IconChat />, match: (p) => p === "/app" || p.startsWith("/app/chat") },
    { to: "/app/friends", label: "Bạn bè", icon: <IconFriends />, match: (p) => p === "/app/friends" },
    // Ban thiet ke goi day la "Mini App" va IPTV la mot muc BEN TRONG luoi do.
    // Man danh sach Mini App chua duoc dung nen tam tro thang toi IPTV - la
    // mini app duy nhat dang co that.
    { to: "/app/iptv", label: "Mini App", icon: <IconGrid />, match: (p) => p === "/app/iptv" },
  ];

  const initial = (user?.nickname ?? "?").trim().charAt(0).toUpperCase();

  return (
    <nav className="rail" aria-label="Điều hướng chính">
      <div className="rail-top">
        <Link
          to="/app/profile"
          className={`rail-avatar${location.pathname === "/app/profile" ? " active" : ""}`}
          aria-label={`Trang cá nhân của ${user?.nickname ?? "bạn"}`}
          title={user?.nickname ?? "Cá nhân"}
        >
          {initial}
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

      <div className="rail-bottom" ref={menuRef}>
        <button
          type="button"
          className={`rail-item rail-gear${menuOpen ? " active" : ""}`}
          onClick={() => setMenuOpen((v) => !v)}
          aria-haspopup="menu"
          aria-expanded={menuOpen}
          aria-label="Cài đặt"
        >
          <IconGear />
          <span className="rail-label">Cài đặt</span>
        </button>

        {menuOpen && (
          <div className="rail-menu" role="menu">
            <button role="menuitem" onClick={() => { setMenuOpen(false); navigate("/workspaces"); }}>
              Quản lý nhóm
            </button>
            <button role="menuitem" onClick={() => { setMenuOpen(false); navigate("/app/profile"); }}>
              Trang cá nhân
            </button>
            {isAdmin && (
              <button role="menuitem" onClick={() => { setMenuOpen(false); navigate("/admin/users"); }}>
                Quản trị
              </button>
            )}
            <button role="menuitem" className="rail-menu-danger" onClick={() => { setMenuOpen(false); onLogout(); }}>
              Đăng xuất
            </button>
          </div>
        )}
      </div>
    </nav>
  );
}
