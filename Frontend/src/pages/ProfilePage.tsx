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
import { resizeAvatar } from "../lib/imageResize";
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
  const [avatarBusy, setAvatarBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement | null>(null);

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

  async function handleAvatar(file: File) {
    if (!user || !accessToken) return;
    setError(null);
    setSaved(false);
    setAvatarBusy(true);
    try {
      // Cat vuong + nen ngay tai day. Anh may dien thoai 3-8MB gui thang len
      // thi vua ton bang thong vua de dut giua chung; sau buoc nay chi con
      // vai chuc KB. Xem lib/imageResize.ts.
      const { blob } = await resizeAvatar(file);
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

  return (
    <AppShell>
      <div className="st">
        <div className="st-avatar-wrap">
          <Avatar
            userId={user?.id ?? 0}
            nickname={user?.nickname}
            avatarUpdatedAt={user?.avatarUpdatedAt}
            size={340}
            className="st-avatar"
          />

          {/* Huy hieu "+" dung nhu ban thiet ke (node 111:589): 40x40, nen
              #56959E. Cai <input type="file"> that duoc giau di - no khong
              the tao kieu duoc, nen boc trong mot nut de dieu khien. */}
          <button
            type="button"
            className="st-avatar-add"
            onClick={() => fileRef.current?.click()}
            disabled={avatarBusy}
            aria-label={user?.avatarUpdatedAt ? "Đổi ảnh đại diện" : "Thêm ảnh đại diện"}
            title={user?.avatarUpdatedAt ? "Đổi ảnh đại diện" : "Thêm ảnh đại diện"}
          >
            +
          </button>
          <input
            ref={fileRef}
            type="file"
            accept="image/png,image/jpeg,image/webp"
            hidden
            onChange={(e) => {
              const f = e.target.files?.[0];
              // Xoa gia tri de chon LAI DUNG tep vua roi van kich hoat onChange
              // - neu khong, nguoi dung cat lai cung mot anh se khong thay gi.
              e.target.value = "";
              if (f) void handleAvatar(f);
            }}
          />
        </div>

        {avatarBusy && <p className="st-msg">Đang xử lý ảnh…</p>}
        {user?.avatarUpdatedAt && !avatarBusy && (
          <button type="button" className="st-remove-avatar" onClick={handleRemoveAvatar}>
            Xoá ảnh đại diện
          </button>
        )}

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
      </div>
    </AppShell>
  );
}
