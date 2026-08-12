import { authApi } from "../api/authApi";
import { useAuthStore } from "../store/authStore";
import { decodeJwtExpMs } from "./jwt";
import { extendKeyExpiry, clearPersistedKey } from "./crypto/keyPersistence";

let refreshTimer: ReturnType<typeof setTimeout> | null = null;

function clearTimer() {
  if (refreshTimer) {
    clearTimeout(refreshTimer);
    refreshTimer = null;
  }
}

// Sliding expiration phia UI: goi POST /auth/refresh o 80% thoi gian song
// cua token (con "hoat dong" = app van dang mo). Neu refresh that bai (token
// het han that su / tai khoan bi khoa), don session - ProtectedRoute se tu
// dieu huong ve /login.
export function scheduleTokenRefresh(accessToken: string) {
  clearTimer();
  const expMs = decodeJwtExpMs(accessToken);
  if (expMs === null) return;

  const msUntilRefresh = Math.max((expMs - Date.now()) * 0.8, 1_000);
  refreshTimer = setTimeout(async () => {
    try {
      const { data } = await authApi.refresh();
      useAuthStore.getState().setAuth(data.accessToken, data.user);
      // Key E2EE cuc bo "song" cung nhip voi JWT - moi lan token duoc gia
      // han thi han luu key cung duoc keo dai theo, dung yeu cau "luu den
      // khi het han JWT" thay vi 1 moc co dinh luc dang nhap.
      const newExpMs = decodeJwtExpMs(data.accessToken);
      if (newExpMs !== null) extendKeyExpiry(newExpMs);
      scheduleTokenRefresh(data.accessToken);
    } catch {
      useAuthStore.getState().clearAuth();
      clearPersistedKey();
    }
  }, msUntilRefresh);
}

export function stopTokenRefresh() {
  clearTimer();
}
