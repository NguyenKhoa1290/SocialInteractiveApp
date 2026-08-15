import type { ReactNode } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { authApi } from "../../api/authApi";
import { useAuthStore } from "../../store/authStore";
import { useKeyStore } from "../../store/keyStore";
import { stopTokenRefresh } from "../../lib/tokenScheduler";
import { clearPersistedKey } from "../../lib/crypto/keyPersistence";
import "./admin.css";

// Vo rieng cho khu Admin, KHONG dung AppShell: dock duoi cua AppShell la
// dieu huong cua nguoi dung thuong (Chat/Nhom/Ban be), tron vao day chi lam
// roi. Admin co thanh dieu huong ngang cua rieng no.
const tabs = [
  { to: "/admin/users", label: "Người dùng" },
  { to: "/admin/violations", label: "Vi phạm spam" },
  { to: "/admin/complaints", label: "Khiếu nại" },
  { to: "/admin/storage", label: "Nạp dung lượng" },
  { to: "/admin/system", label: "Tài nguyên" },
];

export function AdminShell({ title, children }: { title: string; children: ReactNode }) {
  const location = useLocation();
  const navigate = useNavigate();
  const user = useAuthStore((s) => s.user);
  const clearAuth = useAuthStore((s) => s.clearAuth);

  async function handleLogout() {
    try {
      await authApi.logout();
    } catch {
      // token co the da het han - van cho logout phia client binh thuong
    }
    stopTokenRefresh();
    clearAuth();
    clearPersistedKey();
    useKeyStore.getState().clearKeys();
    navigate("/login");
  }

  return (
    <div className="adm-shell">
      <header className="adm-header">
        <div className="adm-brand">
          Quản trị
          <span className="adm-brand-sub">Chat App</span>
        </div>
        <div className="adm-header-right">
          <Link to="/app" className="adm-link-plain">
            ← Về ứng dụng
          </Link>
          <span className="adm-user">{user?.nickname}</span>
          <button onClick={handleLogout} className="adm-btn adm-btn-ghost">
            Đăng xuất
          </button>
        </div>
      </header>

      <nav className="adm-tabs">
        {tabs.map((t) => (
          <Link
            key={t.to}
            to={t.to}
            className={`adm-tab${location.pathname.startsWith(t.to) ? " active" : ""}`}
          >
            {t.label}
          </Link>
        ))}
      </nav>

      <main className="adm-main">
        <h1 className="adm-title">{title}</h1>
        {children}
      </main>
    </div>
  );
}
