import { useEffect, useState } from "react";
import { vaultState, setupVault, unlockVault, resetVault } from "../lib/crypto/vault";
import type { VaultState } from "../lib/crypto/vault";
import { useAuthStore } from "../store/authStore";
import { useKeyStore } from "../store/keyStore";
import wordmark from "../assets/calli/calli-wordmark.svg";
import "./e2ee-popup.css";

// Popup mat khau ma hoa dau cuoi, hien NGAY SAU KHI DANG NHAP.
//
// Figma node 100:180 (nhap mat khau) va 100:221 (dat mat khau lan dau):
// khung 518 bo 37, logo, tieu de "Calli: Ma hoa dau cuoi" 36px w700, mot o
// nhap 424x60, nut 198x65 #56959E, loi 12px w200 do.
//
// Truoc day day la mot the nam CHEN GIUA khung chat - nguoi dung phai vao mot
// cuoc tro chuyen roi moi thay, va no day tin nhan xuong.

type Mode = "checking" | "setup" | "unlock" | "reset" | "unknown";

export function E2eePopup() {
  const accessToken = useAuthStore((s) => s.accessToken);
  const privateKey = useKeyStore((s) => s.privateKey);

  const [mode, setMode] = useState<Mode>("checking");
  const [pin, setPin] = useState("");
  const [acceptedLoss, setAcceptedLoss] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  // Nguoi dung tam bo qua - de ho van dung duoc phan khong can ma hoa (gui
  // anh, tep, xem thong bao) thay vi bi chan cung.
  const [boQua, setBoQua] = useState(false);

  useEffect(() => {
    if (!accessToken || privateKey) return;
    let huy = false;
    void vaultState().then((st: VaultState) => {
      if (huy) return;
      setMode(st === "yes" ? "unlock" : st === "no" ? "setup" : "unknown");
    });
    return () => {
      huy = true;
    };
  }, [accessToken, privateKey]);

  if (!accessToken || privateKey || boQua || mode === "checking") return null;

  function doiSang(next: Mode) {
    setMode(next);
    setPin("");
    setAcceptedLoss(false);
    setError(null);
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!/^\d{6}$/.test(pin)) {
      setError("Mật khẩu phải gồm đúng 6 chữ số");
      return;
    }
    setLoading(true);
    try {
      if (mode === "unlock") await unlockVault(pin);
      else if (mode === "reset") await resetVault(pin);
      else await setupVault(pin);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Không mở khoá được");
    } finally {
      setLoading(false);
    }
  }

  const tieuDe = "Calli: Mã hóa đầu cuối";

  return (
    <div className="e2-overlay">
      <div className="e2-card" role="dialog" aria-modal="true" aria-label={tieuDe}>
        {/* Dong = tam bo qua, KHONG phai bo tinh nang: van dung duoc moi thu
            khong can ma hoa. Lan sau vao lai popup hien lai. */}
        <button type="button" className="e2-close" onClick={() => setBoQua(true)}>
          <svg width="24" height="24" viewBox="0 0 24 24" aria-hidden="true">
            <path d="M5 5l14 14M19 5L5 19" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" />
          </svg>
          Đóng
        </button>

        <img className="e2-logo" src={wordmark} alt="Calli" />
        <h1 className="e2-title">{tieuDe}</h1>

        {mode === "unknown" ? (
          <>
            <p className="e2-note">
              Không kiểm tra được trạng thái mã hoá của tài khoản. Đừng đặt mật khẩu mới lúc này — làm vậy sẽ
              tạo khoá mới và mọi tin nhắn chữ cũ sẽ không đọc lại được.
            </p>
            <button className="e2-btn" onClick={() => doiSang("checking")} type="button">
              Thử lại
            </button>
          </>
        ) : (
          <form onSubmit={submit} className="e2-form">
            <p className="e2-label">
              {mode === "unlock" ? "Nhập mật khẩu 6 số" : "Đặt mật khẩu 6 số"}
            </p>

            <input
              className="e2-input"
              type="password"
              inputMode="numeric"
              autoComplete="off"
              maxLength={6}
              placeholder="Nhập mật khẩu"
              aria-label="Mật khẩu mã hoá"
              value={pin}
              onChange={(e) => setPin(e.target.value.replace(/\D/g, ""))}
              autoFocus
            />

            {error && <p className="e2-error">{error}</p>}

            {mode === "reset" && (
              <label className="e2-check">
                <input type="checkbox" checked={acceptedLoss} onChange={(e) => setAcceptedLoss(e.target.checked)} />
                Tôi hiểu rằng mọi tin nhắn chữ cũ của tôi sẽ không đọc lại được
              </label>
            )}

            <button
              className="e2-btn"
              type="submit"
              disabled={loading || (mode === "reset" && !acceptedLoss)}
            >
              {loading
                ? "Đang xử lý…"
                : mode === "unlock"
                  ? "Xác thực"
                  : mode === "reset"
                    ? "Đặt lại mật khẩu"
                    : "Đặt mật khẩu"}
            </button>

            {mode === "unlock" && (
              <p className="e2-foot">
                Nếu bạn quên, hãy đặt lại và chấp nhận tin nhắn chữ cũ không đọc lại được.{" "}
                <button type="button" className="e2-link" onClick={() => doiSang("reset")}>
                  Đặt lại
                </button>
              </p>
            )}
            {mode === "reset" && (
              <p className="e2-foot">
                <button type="button" className="e2-link" onClick={() => doiSang("unlock")}>
                  Quay lại nhập mật khẩu cũ
                </button>
              </p>
            )}
          </form>
        )}
      </div>
    </div>
  );
}
