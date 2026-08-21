import { Link, useLocation } from "react-router-dom";
import { useNotificationStore } from "../store/notificationStore";

const tabs = [
  { to: "/app", label: "Chat", match: (p: string) => p === "/app" },
  { to: "/workspaces", label: "Nhóm", match: (p: string) => p.startsWith("/workspaces") },
  { to: "/app/friends", label: "Bạn bè", match: (p: string) => p === "/app/friends" },
  { to: "/app/notifications", label: "Thông báo", match: (p: string) => p === "/app/notifications" },
  { to: "/app/iptv", label: "IPTV", match: (p: string) => p === "/app/iptv" },
  { to: "/app/profile", label: "Cá nhân", match: (p: string) => p === "/app/profile" },
];

export function BottomDock() {
  const location = useLocation();
  const unreadCount = useNotificationStore((s) => s.unreadCount);

  return (
    <nav className="bottom-dock">
      {tabs.map((tab) => (
        <Link key={tab.to} to={tab.to} className={`bottom-dock-tab${tab.match(location.pathname) ? " active" : ""}`}>
          {tab.label}
          {tab.to === "/app/notifications" && unreadCount > 0 && (
            // Qua 99 thi con so chinh xac khong con y nghia, chi lam vo o.
            <span className="bottom-dock-badge">{unreadCount > 99 ? "99+" : unreadCount}</span>
          )}
        </Link>
      ))}
    </nav>
  );
}
