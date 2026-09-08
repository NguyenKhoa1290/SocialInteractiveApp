import { useRef, useState } from "react";
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
import { Avatar } from "../components/Avatar";
import { AvatarCropDialog } from "../components/AvatarCropDialog";
import "./settings.css";

// Ho so tach ro rang ten hien thi va handle: ten hien thi la thu nguoi khac
// thay trong phong hop/chat; handle @... la dinh danh duy nhat de tim kiem.
export function ProfilePage() {
  const navigate = useNavigate();
  const user = useAuthStore((s) => s.user);
  const accessToken = useAuthStore((s) => s.accessToken);
  const setAuth = useAuthStore((s) => s.setAuth);
  const clearAuth = useAuthStore((s) => s.clearAuth);
  const isAdmin = accessToken !== null && decodeJwtIsAdmin(accessToken);

  const [editing, setEditing] = useState<"display" | "nickname" | null>(null);
  const [displayName, setDisplayName] = useState(user?.displayName ?? "");
  const [nickname, setNickname] = useState(user?.nickname ?? "");
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [saving, setSaving] = useState(false);
  const [avatarBusy, setAvatarBusy] = useState(false);
  const [avatarToCrop, setAvatarToCrop] = useState<File | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);

  async function saveDisplayName(e: React.FormEvent) {
    e.preventDefault();
    if (!user || !accessToken) return;
    const value = displayName.trim();
    if (!value || value === user.displayName) {
      setDisplayName(user.displayName);
      setEditing(null);
      return;
    }

    setError(null);
    setSaved(false);
    setSaving(true);
    try {
      const { data } = await authApi.updateDisplayName(value);
      setAuth(accessToken, data);
      setSaved(true);
      setEditing(null);
    } catch (err) {
      setError(extractApiError(err, "Không đổi được tên hiển thị"));
    } finally {
      setSaving(false);
    }
  }

  async function saveNickname(e: React.FormEvent) {
    e.preventDefault();
    if (!user || !accessToken) return;
    const value = nickname.trim();
    if (!value || value === user.nickname) {
      setNickname(user.nickname);
      setEditing(null);
      return;
    }

    setError(null);
    setSaved(false);
    setSaving(true);
    try {
      const { data } = await authApi.updateNickname(value);
      setAuth(accessToken, data);
      setNickname(data.nickname);
      setSaved(true);
      setEditing(null);
    } catch (err) {
      setError(extractApiError(err, "Không đổi được biệt danh"));
    } finally {
      setSaving(false);
    }
  }

  async function handleAvatar(blob: Blob) {
    if (!user || !accessToken) return;
    setError(null);
    setSaved(false);
    setAvatarBusy(true);
    try {
      const { data } = await authApi.uploadAvatar(blob);
      setAuth(accessToken, data);
    } catch (err) {
      setError(err instanceof Error && !("response" in err)
        ? err.message
        : extractApiError(err, "Không đổi được ảnh đại diện"));
    } finally {
      setAvatarBusy(false);
    }
  }

  async function handleRemoveAvatar() {
    if (!user || !accessToken) return;
    setError(null);
    setAvatarBusy(true);
    try {
      const { data } = await authApi.deleteAvatar();
      setAuth(accessToken, data);
    } catch (err) {
      setError(extractApiError(err, "Không xoá được ảnh đại diện"));
    } finally {
      setAvatarBusy(false);
    }
  }

  async function handleLogout() {
    try {
      await authApi.logout();
    } catch {
      // Token co the da het han, van xoa session local binh thuong.
    }
    stopTokenRefresh();
    clearAuth();
    clearPersistedKey();
    useKeyStore.getState().clearKeys();
    await stopNotificationHub();
    useNotificationStore.getState().clear();
    navigate("/");
  }

  const shownDisplayName = user?.displayName ?? "Người dùng";

  return (
    <AppShell>
      <div className="st">
        <div className="st-avatar-wrap">
          <Avatar
            userId={user?.id ?? 0}
            nickname={shownDisplayName}
            avatarUpdatedAt={user?.avatarUpdatedAt}
            size={340}
            className="st-avatar"
          />
          <button
            type="button"
            className="st-avatar-add"
            onClick={() => fileRef.current?.click()}
            disabled={avatarBusy}
            aria-label={user?.avatarUpdatedAt ? "Đổi ảnh đại diện" : "Thêm ảnh đại diện"}
          >
            +
          </button>
          <input
            ref={fileRef}
            type="file"
            accept="image/png,image/jpeg,image/webp"
            hidden
            onChange={(e) => {
              const file = e.target.files?.[0];
              e.target.value = "";
              if (file) setAvatarToCrop(file);
            }}
          />
        </div>

        {avatarBusy && <p className="st-msg">Đang xử lý ảnh…</p>}
        {user?.avatarUpdatedAt && !avatarBusy && (
          <button type="button" className="st-remove-avatar" onClick={handleRemoveAvatar}>
            Xoá ảnh đại diện
          </button>
        )}

        {editing === "display" ? (
          <form onSubmit={saveDisplayName}>
            <input
              className="st-name-input"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
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
                setDisplayName(user?.displayName ?? "");
                setSaved(false);
                setEditing("display");
              }}
              title="Đổi tên hiển thị"
            >
              {shownDisplayName}
            </button>
          </p>
        )}

        {editing === "nickname" ? (
          <form onSubmit={saveNickname}>
            <input
              className="st-handle-input"
              value={nickname}
              onChange={(e) => setNickname(e.target.value.toUpperCase())}
              maxLength={24}
              autoFocus
              aria-label="Biệt danh duy nhất"
              pattern="[A-Z][A-Z0-9_]{2,23}"
              title="3-24 ký tự A-Z, 0-9 hoặc _, bắt đầu bằng chữ cái"
            />
          </form>
        ) : (
          <button
            type="button"
            className="st-handle"
            onClick={() => {
              setNickname(user?.nickname ?? "");
              setSaved(false);
              setEditing("nickname");
            }}
            title="Đổi biệt danh"
          >
            @{user?.nickname ?? "USER"}
          </button>
        )}

        <p className="st-handle-note">Biệt danh là duy nhất và dùng để tìm kiếm.</p>
        {saving && <p className="st-msg">Đang lưu…</p>}
        {error && <p className="st-msg st-msg-err">{error}</p>}
        {saved && !error && <p className="st-msg st-msg-ok">Đã lưu thay đổi</p>}

        <button type="button" className="st-btn st-btn-logout" onClick={handleLogout}>
          Đăng xuất
        </button>
        {isAdmin && (
          <Link to="/admin/users" className="st-btn st-btn-admin">
            Chế độ quản trị
          </Link>
        )}
      </div>

      {avatarToCrop && (
        <AvatarCropDialog
          file={avatarToCrop}
          title="Chọn vùng ảnh đại diện"
          onClose={() => setAvatarToCrop(null)}
          onCropped={handleAvatar}
        />
      )}
    </AppShell>
  );
}
