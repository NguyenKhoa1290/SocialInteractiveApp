import { useEffect, useState } from "react";
import { hasVault, setupVault, unlockVault, resetVault } from "../lib/crypto/vault";
import { useKeyStore } from "../store/keyStore";

// Chan tinh nang can E2EE (soan tin nhan Text) toi khi co private key trong
// bo nho: lan dau thiet lap PIN moi (sinh khoa that), cac lan sau nhap lai
// PIN de giai ma vault da luu tren server (xem lib/crypto/vault.ts).
//
// Mode "reset" la loi thoat cho nguoi QUEN PIN. Truoc day khong co loi thoat
// nao: da co vault thi man nhap PIN la cua duy nhat, quen PIN nghia la khong
// bao gio gui duoc tin nhan Text nua o BAT KY cuoc tro chuyen nao.
type Mode = "checking" | "setup" | "unlock" | "reset";

export function E2eeGate({ children }: { children: React.ReactNode }) {
  const privateKey = useKeyStore((s) => s.privateKey);
  const [mode, setMode] = useState<Mode>("checking");
  const [pin, setPin] = useState("");
  const [confirmPin, setConfirmPin] = useState("");
  const [acceptedLoss, setAcceptedLoss] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (privateKey) return;
    hasVault().then((exists) => setMode(exists ? "unlock" : "setup"));
  }, [privateKey]);

  if (privateKey) return <>{children}</>;

  // Doi qua lai giua cac man - luon don sach o nhap de PIN vua go khong con
  // nam trong bo nho form, va de canh bao "mat tin nhan cu" phai duoc tick
  // lai moi lan chu khong nho trang thai cu.
  function switchTo(next: Mode) {
    setMode(next);
    setPin("");
    setConfirmPin("");
    setAcceptedLoss(false);
    setError(null);
  }

  function validPinPair(): string | null {
    if (!/^\d{6}$/.test(pin)) return "PIN phải gồm đúng 6 chữ số";
    if (pin !== confirmPin) return "2 lần nhập PIN không khớp";
    return null;
  }

  async function handleSetup(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const invalid = validPinPair();
    if (invalid) {
      setError(invalid);
      return;
    }
    setLoading(true);
    try {
      await setupVault(pin);
    } catch {
      setError("Không thiết lập được E2EE, thử lại");
    } finally {
      setLoading(false);
    }
  }

  async function handleUnlock(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      await unlockVault(pin);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Không mở khoá được");
    } finally {
      setLoading(false);
    }
  }

  async function handleReset(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const invalid = validPinPair();
    if (invalid) {
      setError(invalid);
      return;
    }
    setLoading(true);
    try {
      await resetVault(pin);
    } catch {
      setError("Không đặt lại được, thử lại");
    } finally {
      setLoading(false);
    }
  }

  const pinInput = (value: string, onChange: (v: string) => void, placeholder: string) => (
    <input
      className="ws-input"
      type="password"
      inputMode="numeric"
      maxLength={6}
      placeholder={placeholder}
      value={value}
      onChange={(e) => onChange(e.target.value)}
    />
  );

  if (mode === "checking") return <p>Đang kiểm tra E2EE...</p>;

  if (mode === "setup") {
    return (
      <div className="e2ee-gate">
        <h3>Thiết lập mã PIN cho tin nhắn mã hoá</h3>
        <p className="e2ee-gate-note">
          PIN 6 số dùng để bảo vệ khoá mã hoá tin nhắn Text trên mọi thiết bị — ghi nhớ kỹ, mất PIN sẽ
          không đọc lại được tin nhắn Text cũ.
        </p>
        <form onSubmit={handleSetup}>
          {pinInput(pin, setPin, "Nhập PIN 6 số")}
          {pinInput(confirmPin, setConfirmPin, "Nhập lại PIN")}
          {error && <p className="ws-error">{error}</p>}
          <button className="ws-btn-primary" disabled={loading} type="submit">
            {loading ? "Đang thiết lập..." : "Thiết lập"}
          </button>
        </form>
      </div>
    );
  }

  if (mode === "reset") {
    return (
      <div className="e2ee-gate">
        <h3>Đặt lại mã PIN</h3>
        <p className="e2ee-gate-note">
          Khoá cũ chỉ tồn tại dưới dạng đã mã hoá bằng chính mã PIN bạn quên, nên không có cách nào lấy
          lại được. Đặt lại sẽ tạo <strong>cặp khoá hoàn toàn mới</strong>.
        </p>
        <p className="ws-error">
          Toàn bộ tin nhắn Text cũ của bạn sẽ <strong>vĩnh viễn không đọc lại được</strong> — kể cả trên
          thiết bị này. File, ảnh, video và tin nhắn trong cuộc họp thì không bị ảnh hưởng.
        </p>
        <form onSubmit={handleReset}>
          <label className="e2ee-gate-confirm">
            <input
              type="checkbox"
              checked={acceptedLoss}
              onChange={(e) => setAcceptedLoss(e.target.checked)}
            />
            <span>Tôi hiểu và chấp nhận mất toàn bộ tin nhắn Text cũ</span>
          </label>
          {pinInput(pin, setPin, "PIN mới 6 số")}
          {pinInput(confirmPin, setConfirmPin, "Nhập lại PIN mới")}
          {error && <p className="ws-error">{error}</p>}
          <button className="ws-btn-primary" disabled={loading || !acceptedLoss} type="submit">
            {loading ? "Đang đặt lại..." : "Đặt lại PIN"}
          </button>
          <button className="ws-btn-secondary" type="button" onClick={() => switchTo("unlock")}>
            Quay lại
          </button>
        </form>
      </div>
    );
  }

  return (
    <div className="e2ee-gate">
      <h3>Nhập PIN để mở khoá tin nhắn mã hoá</h3>
      <form onSubmit={handleUnlock}>
        {pinInput(pin, setPin, "PIN 6 số")}
        {error && <p className="ws-error">{error}</p>}
        <button className="ws-btn-primary" disabled={loading} type="submit">
          {loading ? "Đang mở..." : "Mở khoá"}
        </button>
      </form>
      <button className="e2ee-gate-forgot" type="button" onClick={() => switchTo("reset")}>
        Quên PIN?
      </button>
    </div>
  );
}
