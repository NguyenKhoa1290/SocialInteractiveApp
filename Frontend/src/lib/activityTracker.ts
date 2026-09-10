import { authApi } from "../api/authApi";
import { useAuthStore } from "../store/authStore";

const KHOANG_BAO_CAO_MS = 5 * 60 * 1000;

let daBatDau = false;
let lanBaoCaoGanNhat = 0;
let dangBaoCao = false;

// Dung su kien tuong tac thay vi setInterval: mo tab roi bo do khong tu nhien
// keo dai han Guest. Server cung khoa Redis 5 phut/user cho nhieu tab.
async function baoCaoHoatDong() {
  if (document.visibilityState !== "visible" || !useAuthStore.getState().accessToken) return;

  const now = Date.now();
  if (dangBaoCao || now - lanBaoCaoGanNhat < KHOANG_BAO_CAO_MS) return;

  dangBaoCao = true;
  lanBaoCaoGanNhat = now;
  try {
    await authApi.recordActivity();
  } catch {
    // Request phu: loi mang khong duoc lam hong chat/cuoc hop.
    // Interceptor chung van xu ly 401 neu session da het han that su.
  } finally {
    dangBaoCao = false;
  }
}

export function batTheoDoiHoatDong() {
  if (daBatDau) {
    void baoCaoHoatDong();
    return;
  }

  daBatDau = true;
  const khiTuongTac = () => void baoCaoHoatDong();
  const khiDoiHienThi = () => {
    if (document.visibilityState === "visible") void baoCaoHoatDong();
  };

  window.addEventListener("pointerdown", khiTuongTac, { passive: true });
  window.addEventListener("keydown", khiTuongTac);
  window.addEventListener("touchstart", khiTuongTac, { passive: true });
  document.addEventListener("visibilitychange", khiDoiHienThi);
  void baoCaoHoatDong();
}
