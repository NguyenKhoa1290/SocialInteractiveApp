import { Link, useLocation } from "react-router-dom";

const tabs = [
  { to: "/app", label: "Chat", match: (p: string) => p === "/app" },
  { to: "/workspaces", label: "Nhóm", match: (p: string) => p.startsWith("/workspaces") },
  { to: "/app/friends", label: "Bạn bè", match: (p: string) => p === "/app/friends" },
  { to: "/app/iptv", label: "IPTV", match: (p: string) => p === "/app/iptv" },
  { to: "/app/profile", label: "Cá nhân", match: (p: string) => p === "/app/profile" },
];

export function BottomDock() {
  const location = useLocation();

  return (
    <nav className="bottom-dock">
      {tabs.map((tab) => (
        <Link key={tab.to} to={tab.to} className={`bottom-dock-tab${tab.match(location.pathname) ? " active" : ""}`}>
          {tab.label}
        </Link>
      ))}
    </nav>
  );
}
