import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { complaintsApi } from "../api/chatApi";
import { extractApiError } from "../lib/apiError";
import "./auth/auth.css";

// Kenh khieu nai tach biet hoan toan khoi chat thong thuong - PHAI truy cap
// duoc ke ca khi tai khoan dang bi khoa (xem ComplaintsEndpoints.cs: JWT van
// hop le du status=locked, Chat Service khong kiem tra status). KHONG bao
// trong AppShell/NavRail vi tai khoan bi khoa khong nen thay duoc dieu
// huong sang cac tinh nang chat binh thuong.
export function ComplaintsPage() {
  const [messages, setMessages] = useState<{ senderRole: string; message: string; createdAt: string }[] | null>(null);
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);

  async function load() {
    try {
      const { data } = await complaintsApi.list();
      setMessages(data);
    } catch (err) {
      setError(extractApiError(err, "Không tải được lịch sử khiếu nại"));
    }
  }

  useEffect(() => {
    load();
  }, []);

  async function handleSend(e: React.FormEvent) {
    e.preventDefault();
    if (!text.trim()) return;
    setSending(true);
    setError(null);
    try {
      await complaintsApi.send(text.trim());
      setText("");
      await load();
    } catch (err) {
      setError(extractApiError(err, "Không gửi được khiếu nại"));
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="auth-page">
      <div className="auth-card" style={{ width: 480 }}>
        <h1>Khiếu nại</h1>
        <p style={{ fontSize: 13, color: "var(--text)", marginBottom: 16 }}>
          Gửi khiếu nại nếu bạn cho rằng tài khoản bị khoá nhầm. Kênh này hoạt động kể cả khi tài
          khoản đang bị khoá.
        </p>

        {error && <p className="auth-error">{error}</p>}

        <div style={{ maxHeight: 320, overflowY: "auto", marginBottom: 16 }}>
          {messages === null && <p>Đang tải...</p>}
          {messages?.length === 0 && <p style={{ fontSize: 13, color: "var(--text)" }}>Chưa có khiếu nại nào.</p>}
          {messages?.map((m, i) => (
            <div
              key={i}
              style={{
                textAlign: m.senderRole === "user" ? "right" : "left",
                margin: "8px 0",
              }}
            >
              <div
                style={{
                  display: "inline-block",
                  maxWidth: "80%",
                  padding: "8px 12px",
                  borderRadius: 10,
                  background: m.senderRole === "user" ? "var(--accent-bg)" : "var(--social-bg)",
                  fontSize: 13,
                }}
              >
                {m.message}
              </div>
            </div>
          ))}
        </div>

        <form onSubmit={handleSend} style={{ display: "flex", gap: 8 }}>
          <input className="auth-input" style={{ marginBottom: 0 }} value={text} onChange={(e) => setText(e.target.value)} placeholder="Nội dung khiếu nại..." />
          <button className="auth-btn-primary" style={{ width: "auto", padding: "0 16px" }} disabled={sending} type="submit">
            Gửi
          </button>
        </form>

        <p className="auth-footer">
          <Link to="/login">Về trang đăng nhập</Link>
        </p>
      </div>
    </div>
  );
}
