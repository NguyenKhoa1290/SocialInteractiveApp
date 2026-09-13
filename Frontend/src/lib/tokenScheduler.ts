import { authApi } from "../api/authApi";
import { isAxiosError } from "axios";
import { useAuthStore } from "../store/authStore";
import { decodeJwtExpMs, decodeJwtIatMs } from "./jwt";
import { extendKeyExpiry, clearPersistedKey } from "./crypto/keyPersistence";

let refreshTimer: ReturnType<typeof setTimeout> | null = null;
let refreshInFlight: Promise<boolean> | null = null;
const RETRY_AFTER_NETWORK_ERROR_MS = 30_000;
const REFRESH_BEFORE_EXPIRY_MS = 5 * 60 * 1000;

function clearTimer() {
  if (refreshTimer) {
    clearTimeout(refreshTimer);
    refreshTimer = null;
  }
}

function clearSessionIfUnchanged(accessTokenAtStart: string | null) {
  // Trang dang nhap co the hoan tat trong luc request bootstrap cu dang bay.
  // Khong duoc de phan hoi 401 cu xoa phien moi vua tao.
  if (useAuthStore.getState().accessToken !== accessTokenAtStart) return;
  clearTimer();
  useAuthStore.getState().clearAuth();
  clearPersistedKey();
}

function isTerminalSessionError(error: unknown) {
  return isAxiosError(error) && (error.response?.status === 401 || error.response?.status === 403);
}

// Goi persistent-session endpoint. Mat mang/5xx chi hen thu lai, KHONG day
// nguoi dang dung app ve trang dang nhap. 401/403 moi la cookie da het han,
// bi thu hoi hoac tai khoan bi khoa.
export async function refreshAccessToken(): Promise<boolean> {
  if (refreshInFlight) return refreshInFlight;

  const accessTokenAtStart = useAuthStore.getState().accessToken;
  refreshInFlight = (async () => {
    try {
      const { data } = await authApi.refresh();
      if (useAuthStore.getState().accessToken !== accessTokenAtStart) return false;
      useAuthStore.getState().setAuth(data.accessToken, data.user);
      extendKeyExpiry();
      scheduleTokenRefresh(data.accessToken);
      return true;
    } catch (error) {
      if (isTerminalSessionError(error)) {
        clearSessionIfUnchanged(accessTokenAtStart);
      } else if (useAuthStore.getState().accessToken === accessTokenAtStart) {
        clearTimer();
        refreshTimer = setTimeout(() => { void refreshAccessToken(); }, RETRY_AFTER_NETWORK_ERROR_MS);
      }
      return false;
    } finally {
      refreshInFlight = null;
    }
  })();
  return refreshInFlight;
}

// Sliding expiration phia UI: goi refresh o 80% tuoi tho TOKEN, khong phai
// 80% so phut con lai luc F5. Cong thuc cu co the hen sau luc token het han
// neu nguoi dung tai lai trang giua chung.
export function scheduleTokenRefresh(accessToken: string) {
  clearTimer();
  const expMs = decodeJwtExpMs(accessToken);
  if (expMs === null) return;

  const iatMs = decodeJwtIatMs(accessToken);
  const targetMs = iatMs !== null && iatMs < expMs
    ? iatMs + (expMs - iatMs) * 0.8
    : expMs - REFRESH_BEFORE_EXPIRY_MS;
  refreshTimer = setTimeout(() => { void refreshAccessToken(); }, Math.max(targetMs - Date.now(), 1_000));
}

// Timer JS co the bi dong bang khi trinh duyet o nen. Khi nguoi dung quay lai,
// refresh truoc khi cac API khac gap 401 va giu phien khong bi vang ra.
export function refreshWhenReturningToApp() {
  const accessToken = useAuthStore.getState().accessToken;
  if (!accessToken) return;
  const expMs = decodeJwtExpMs(accessToken);
  if (expMs === null || expMs - Date.now() <= REFRESH_BEFORE_EXPIRY_MS)
    void refreshAccessToken();
}

export function stopTokenRefresh() {
  clearTimer();
}
