import type { ReactNode } from "react";
import { Link, useNavigate } from "react-router-dom";
import { authApi } from "../api/authApi";
import { useAuthStore } from "../store/authStore";
import { useKeyStore } from "../store/keyStore";
import { stopTokenRefresh } from "../lib/tokenScheduler";
import { decodeJwtIsAdmin } from "../lib/jwt";
import { clearPersistedKey } from "../lib/crypto/keyPersistence";
import { BottomDock } from "./BottomDock";
import "./app-shell.css";

export function AppShell({ children }: { children: ReactNode }) {
  const navigate = useNavigate();
  const user = useAuthStore((s) => s.user);
  const accessToken = useAuthStore((s) => s.accessToken);
  const clearAuth = useAuthStore((s) => s.clearAuth);
  // Loi vao khu quan tri chi hien voi tai khoan co claim role=admin - de o
  // header thay vi dock duoi, vi dock la dieu huong cua nguoi dung thuong.
  const isAdmin = accessToken !== null && decodeJwtIsAdmin(accessToken);

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
    <div className="shell">
      <header className="shell-header">
        <Link to="/app" className="shell-brand">
          Chat App
        </Link>
        <div className="shell-user">
          {isAdmin && (
            <Link to="/admin/users" className="shell-admin-link">
              Quản trị
            </Link>
          )}
          <span>{user?.nickname}</span>
          <button onClick={handleLogout} className="shell-logout-btn">
            Đăng xuất
          </button>
        </div>
      </header>
      <main className="shell-main">{children}</main>
      <BottomDock />
    </div>
  );
}
