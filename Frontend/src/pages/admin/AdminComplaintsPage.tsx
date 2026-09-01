import { useCallback, useEffect, useState } from "react";
import { adminApi } from "../../api/adminApi";
import { extractApiError } from "../../lib/apiError";
import { AdminShell } from "./AdminShell";
import { formatDateTime, formatRemaining } from "./format";
import type { ComplaintMessage, ComplaintSummary } from "../../types/admin";

export function AdminComplaintsPage() {
  const [items, setItems] = useState<ComplaintSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [openUserId, setOpenUserId] = useState<number | null>(null);
  const [messages, setMessages] = useState<ComplaintMessage[] | null>(null);
  const [threadError, setThreadError] = useState<string | null>(null);
  const [reply, setReply] = useState("");
  const [sending, setSending] = useState(false);

  const load = useCallback(() => {
    setError(null);
    adminApi
      .listComplaints()
      .then((res) => setItems(res.data))
      .catch((err) => setError(extractApiError(err, "Không tải được danh sách khiếu nại")));
  }, []);

  useEffect(load, [load]);

  function openThread(userId: number) {
    setOpenUserId(userId);
    setMessages(null);
    setThreadError(null);
    setReply("");
    adminApi
      .getComplaintMessages(userId)
      .then((res) => setMessages(res.data))
      // 404 o day KHONG phai loi he thong: khieu nai song 10 tieng trong
      // Redis roi tu bien mat. Noi dung phai giai thich dung, khong de
      // nguoi dung tuong la hong.
      .catch((err) => setThreadError(extractApiError(err, "Khiếu nại đã quá 10 tiếng hoặc không tồn tại")));
  }

  async function sendReply(e: React.FormEvent) {
    e.preventDefault();
    if (openUserId === null || !reply.trim()) return;
    setSending(true);
    setThreadError(null);
    try {
      const res = await adminApi.replyComplaint(openUserId, reply.trim());
      // Noi tin vua gui vao cuoi hoi thoai thay vi tai lai ca luong - phan
      // hoi tra ve chinh la ban ghi da luu nen khong lech du lieu.
      setMessages((prev) => (prev ? [...prev, res.data] : [res.data]));
      setReply("");
      load(); // lastMessageAt o danh sach ngoai doi theo
    } catch (err) {
      setThreadError(extractApiError(err, "Gửi phản hồi thất bại"));
    } finally {
      setSending(false);
    }
  }

  return (
    <AdminShell title="Khiếu nại">
      <p className="adm-hint">
        Khiếu nại được giữ trong Redis với TTL 10 tiếng - quá hạn sẽ tự biến mất, không lưu vĩnh viễn.
      </p>

      {error && <p className="adm-error">{error}</p>}
      {items === null && !error && <p className="adm-muted">Đang tải...</p>}
      {items !== null && items.length === 0 && <p className="adm-empty">Không có khiếu nại nào đang chờ.</p>}

      {items !== null && items.length > 0 && (
        <div className="adm-table-wrap">
          <table className="adm-table">
            <thead>
              <tr>
                <th>User</th>
                <th>Tin nhắn cuối</th>
                <th>Hết hạn</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {items.map((c) => (
                <tr key={c.userId} className={openUserId === c.userId ? "selected" : undefined}>
                  <td className="adm-mono">#{c.userId}</td>
                  <td className="adm-muted">{formatDateTime(c.lastMessageAt)}</td>
                  <td className="adm-muted">{formatRemaining(c.expiresAt)}</td>
                  <td>
                    <button className="adm-btn adm-btn-ghost" onClick={() => openThread(c.userId)}>
                      Mở hội thoại
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {openUserId !== null && (
        <section className="adm-panel">
          <div className="adm-panel-head">
            <h2>
              Khiếu nại của <span className="adm-mono">#{openUserId}</span>
            </h2>
            <button className="adm-btn adm-btn-ghost" onClick={() => setOpenUserId(null)}>
              Đóng
            </button>
          </div>

          {threadError && <p className="adm-error">{threadError}</p>}
          {messages === null && !threadError && <p className="adm-muted">Đang tải hội thoại...</p>}

          {messages !== null && (
            <div className="adm-thread">
              {messages.length === 0 && <p className="adm-muted">Chưa có tin nhắn nào.</p>}
              {messages.map((m, i) => (
                <div key={i} className={`adm-msg${m.senderRole === "admin" ? " admin" : ""}`}>
                  <div className="adm-msg-meta">
                    {m.senderRole === "admin" ? "Quản trị viên" : "Người dùng"} ·{" "}
                    {formatDateTime(m.createdAt)}
                  </div>
                  <div className="adm-msg-body">{m.message}</div>
                </div>
              ))}
            </div>
          )}

          <form onSubmit={sendReply} className="adm-reply">
            <textarea
              value={reply}
              onChange={(e) => setReply(e.target.value)}
              placeholder="Nhập phản hồi cho người dùng..."
              rows={3}
              className="adm-textarea"
            />
            <button type="submit" className="adm-btn adm-btn-primary" disabled={sending || !reply.trim()}>
              {sending ? "Đang gửi..." : "Gửi phản hồi"}
            </button>
          </form>
        </section>
      )}
    </AdminShell>
  );
}
