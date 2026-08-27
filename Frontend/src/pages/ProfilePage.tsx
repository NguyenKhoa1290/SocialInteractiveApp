import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { authApi } from "../api/authApi";
import { useAuthStore } from "../store/authStore";
import { useKeyStore } from "../store/keyStore";
import { stopTokenRefresh } from "../lib/tokenScheduler";
import { clearPersistedKey } from "../lib/crypto/keyPersistence";
import { decodeJwtIsAdmin } from "../lib/jwt";
import { extractApiError } from "../lib/apiError";
import { stopNotificationHub } from "../lib/notificationHub";
import { useNotificationStore } from "../store/notificationStore";
import { AppShell } from "../components/AppShell";
import "./settings.css";

// Man "Thong tin" - noi banh rang tren thanh dieu huong dan toi.
// Dung theo Figma node 111:589: anh dai dien lon, ten ben duoi, roi hai nut
// "Dang xuat" (do) va "Che do quan tri" (den, chi hien voi admin).
export function ProfilePage() {
  const navigate = useNavigate();
  const user = useAuthStore((s) => s.user);
  const accessToken = useAuthStore((s) => s.accessToken);
  const setAuth = useAuthStore((s) => s.setAuth);
  const clearAuth = useAuthStore((s) => s.clearAuth);
  const isAdmin = accessToken !== null && decodeJwtIsAdmin(accessToken);

  const [editing, setEditing] = useState(false);
  const [nickname, setNickname] = useState(user?.nickname ?? "");
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [saving, setSaving] = useState(false);

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    if (!user || !accessToken) return;
    const ten = nickname.trim();
    if (ten === "" || ten === user.nickname) {
      setEditing(false);
      setNickname(user.nickname);
      return;
    }
    setError(null);
    setSaved(false);
    setSaving(true);
    try {
      await authApi.updateNickname(ten);
      setAuth(accessToken, { ...user, nickname: ten });
      setSaved(true);
      setEditing(false);
    } catch (err) {
      setError(extractApiError(err, "Không đổi được tên"));
    } finally {
      setSaving(false);
    }
  }

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
    // Khong dong hub thi ket noi cu van giu JWT cu va tiep tuc nhan thong bao
    // cua tai khoan vua thoat - nguoi dang nhap sau se thay chung.
    await stopNotificationHub();
    useNotificationStore.getState().clear();
    navigate("/");
  }

  const initial = (user?.nickname ?? "?").trim().charAt(0).toUpperCase();

  return (
    <AppShell>
      <div className="st">
        {/* Ban thiet ke co huy hieu "+" de doi anh dai dien, nhung bang `users`
            chua co cot nao luu anh - chua noi vao dau duoc nen khong ve mot
            nut bam vao khong ra gi. Tam hien chu cai dau, giong thanh dieu
            huong. */}
        <div className="st-avatar" aria-hidden="true">
          {initial}
        </div>

        {editing ? (
          <form onSubmit={handleSave}>
            <input
              className="st-name-input"
              value={nickname}
              onChange={(e) => setNickname(e.target.value)}
              onBlur={handleSave}
              maxLength={50}
              autoFocus
              aria-label="Tên hiển thị"
            />
          </form>
        ) : (
          <p className="st-name">
            <button
              type="button"
              className="st-name-btn"
              onClick={() => {
                setNickname(user?.nickname ?? "");
                setSaved(false);
                setEditing(true);
              }}
              title="Bấm để đổi tên"
            >
              {user?.nickname ?? "Người dùng"}
            </button>
          </p>
        )}

        {saving && <p className="st-msg">Đang lưu…</p>}
        {error && <p className="st-msg st-msg-err">{error}</p>}
        {saved && !error && <p className="st-msg st-msg-ok">Đã đổi tên</p>}

        <button type="button" className="st-btn st-btn-logout" onClick={handleLogout}>
          Đăng xuất
        </button>

        {isAdmin && (
          <Link to="/admin/users" className="st-btn st-btn-admin">
            Chế độ quản trị
          </Link>
        )}

        {/* Duong phu tam thoi - xem ghi chu trong settings.css */}
        <p className="st-extra">
          <Link to="/workspaces">Quản lý nhóm</Link>
        </p>
      </div>
    </AppShell>
  );
}
