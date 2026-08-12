import { useEffect, useState } from "react";
import { hasVault, setupVault, unlockVault } from "../lib/crypto/vault";
import { useKeyStore } from "../store/keyStore";

// Chan tinh nang can E2EE (soan tin nhan Text) toi khi co private key trong
// bo nho: lan dau thiet lap PIN moi (sinh khoa that), cac lan sau nhap lai
// PIN de giai ma vault da luu tren server (xem lib/crypto/vault.ts).
export function E2eeGate({ children }: { children: React.ReactNode }) {
  const privateKey = useKeyStore((s) => s.privateKey);
  const [mode, setMode] = useState<"checking" | "setup" | "unlock">("checking");
  const [pin, setPin] = useState("");
  const [confirmPin, setConfirmPin] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (privateKey) return;
    hasVault().then((exists) => setMode(exists ? "unlock" : "setup"));
  }, [privateKey]);

  if (privateKey) return <>{children}</>;

  async function handleSetup(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!/^\d{6}$/.test(pin)) {
      setError("PIN phải gồm đúng 6 chữ số");
      return;
    }
    if (pin !== confirmPin) {
      setError("2 lần nhập PIN không khớp");
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
          <input
            className="ws-input"
            type="password"
            inputMode="numeric"
            maxLength={6}
            placeholder="Nhập PIN 6 số"
            value={pin}
            onChange={(e) => setPin(e.target.value)}
          />
          <input
            className="ws-input"
            type="password"
            inputMode="numeric"
            maxLength={6}
            placeholder="Nhập lại PIN"
            value={confirmPin}
            onChange={(e) => setConfirmPin(e.target.value)}
          />
          {error && <p className="ws-error">{error}</p>}
          <button className="ws-btn-primary" disabled={loading} type="submit">
            {loading ? "Đang thiết lập..." : "Thiết lập"}
          </button>
        </form>
      </div>
    );
  }

  return (
    <div className="e2ee-gate">
      <h3>Nhập PIN để mở khoá tin nhắn mã hoá</h3>
      <form onSubmit={handleUnlock}>
        <input
          className="ws-input"
          type="password"
          inputMode="numeric"
          maxLength={6}
          placeholder="PIN 6 số"
          value={pin}
          onChange={(e) => setPin(e.target.value)}
        />
        {error && <p className="ws-error">{error}</p>}
        <button className="ws-btn-primary" disabled={loading} type="submit">
          {loading ? "Đang mở..." : "Mở khoá"}
        </button>
      </form>
    </div>
  );
}
