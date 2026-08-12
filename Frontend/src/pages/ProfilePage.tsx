import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { authApi } from "../api/authApi";
import { useAuthStore } from "../store/authStore";
import { useKeyStore } from "../store/keyStore";
import { stopTokenRefresh } from "../lib/tokenScheduler";
import { clearPersistedKey } from "../lib/crypto/keyPersistence";
import { extractApiError } from "../lib/apiError";
import { AppShell } from "../components/AppShell";

export function ProfilePage() {
  const navigate = useNavigate();
  const user = useAuthStore((s) => s.user);
  const accessToken = useAuthStore((s) => s.accessToken);
  const setAuth = useAuthStore((s) => s.setAuth);
  const clearAuth = useAuthStore((s) => s.clearAuth);

  const [nickname, setNickname] = useState(user?.nickname ?? "");
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [saving, setSaving] = useState(false);

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    if (!user || !accessToken) return;
    setError(null);
    setSaved(false);
    setSaving(true);
    try {
      await authApi.updateNickname(nickname);
      setAuth(accessToken, { ...user, nickname });
      setSaved(true);
    } catch (err) {
      setError(extractApiError(err, "Không đổi được nickname"));
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
    navigate("/login");
  }

  return (
    <AppShell>
      <h1>Cá nhân</h1>
      <p style={{ color: "var(--text)", fontSize: 13 }}>
        {user?.userType === "guest" ? "Tài khoản Guest" : "Tài khoản đã đăng ký"} · ID {user?.id}
      </p>

      <form onSubmit={handleSave} style={{ maxWidth: 360, marginTop: 20 }}>
        <label style={{ fontSize: 13, color: "var(--text)" }}>Nickname</label>
        <input
          value={nickname}
          onChange={(e) => setNickname(e.target.value)}
          maxLength={50}
          required
          style={{
            width: "100%",
            padding: "10px 12px",
            margin: "6px 0 12px",
            borderRadius: 8,
            border: "1px solid var(--border)",
            background: "var(--bg)",
            color: "var(--text-h)",
            fontSize: 14,
            boxSizing: "border-box",
          }}
        />
        {error && <p style={{ color: "#e0526a", fontSize: 14 }}>{error}</p>}
        {saved && <p style={{ color: "var(--accent)", fontSize: 14 }}>Đã lưu</p>}
        <button
          type="submit"
          disabled={saving}
          style={{
            padding: "8px 16px",
            borderRadius: 8,
            border: "none",
            background: "var(--accent)",
            color: "#fff",
            fontWeight: 600,
            cursor: "pointer",
          }}
        >
          {saving ? "Đang lưu..." : "Lưu"}
        </button>
      </form>

      <button
        onClick={handleLogout}
        style={{
          marginTop: 32,
          padding: "8px 16px",
          borderRadius: 8,
          border: "1px solid var(--border)",
          background: "var(--social-bg)",
          color: "var(--text-h)",
          cursor: "pointer",
        }}
      >
        Đăng xuất
      </button>
    </AppShell>
  );
}
