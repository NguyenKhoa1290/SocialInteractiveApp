import { useCallback, useEffect, useState } from "react";
import { adminApi } from "../../api/adminApi";
import { extractApiError } from "../../lib/apiError";
import { AdminShell } from "./AdminShell";
import { formatDateTime } from "./format";
import type { TopupRequestInfo } from "../../types/admin";

export function AdminStoragePage() {
  const [items, setItems] = useState<TopupRequestInfo[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<number | null>(null);

  const load = useCallback(() => {
    setError(null);
    adminApi
      .listTopupRequests()
      .then((res) => setItems(res.data))
      .catch((err) => setError(extractApiError(err, "Không tải được danh sách yêu cầu")));
  }, []);

  useEffect(load, [load]);

  async function decide(req: TopupRequestInfo, approve: boolean) {
    const verb = approve ? "Duyệt" : "Từ chối";
    if (!window.confirm(`${verb} yêu cầu nạp dung lượng #${req.id} của nhóm ${req.conversationId}?`)) return;

    setBusyId(req.id);
    setError(null);
    setNotice(null);
    try {
      if (approve) await adminApi.approveTopup(req.id);
      else await adminApi.rejectTopup(req.id);
      setNotice(`${verb} yêu cầu #${req.id} thành công.`);
      load();
    } catch (err) {
      setError(extractApiError(err, `${verb} yêu cầu thất bại`));
    } finally {
      setBusyId(null);
    }
  }

  return (
    <AdminShell title="Duyệt nạp dung lượng">
      <p className="adm-hint">
        Trưởng nhóm không tự cộng dung lượng được — họ gửi yêu cầu, Admin xác nhận đã nhận tiền ở đây.
        Duyệt xong nhóm mới được nâng hạn mức và mở khoá.
      </p>

      {error && <p className="adm-error">{error}</p>}
      {notice && <p className="adm-notice">{notice}</p>}
      {items === null && !error && <p className="adm-muted">Đang tải...</p>}
      {items !== null && items.length === 0 && <p className="adm-empty">Không có yêu cầu nào đang chờ duyệt.</p>}

      {items !== null && items.length > 0 && (
        <div className="adm-table-wrap">
          <table className="adm-table">
            <thead>
              <tr>
                <th>Mã</th>
                <th>Nhóm</th>
                <th>Người yêu cầu</th>
                <th>Số tiền</th>
                <th>Gửi lúc</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {items.map((r) => (
                <tr key={r.id}>
                  <td className="adm-mono">#{r.id}</td>
                  <td className="adm-mono">{r.conversationId}</td>
                  <td className="adm-mono">#{r.requestedBy}</td>
                  <td>{r.amount.toLocaleString("vi-VN")} đ</td>
                  <td className="adm-muted">{formatDateTime(r.createdAt)}</td>
                  <td className="adm-row-actions">
                    <button
                      className="adm-btn adm-btn-primary"
                      disabled={busyId === r.id}
                      onClick={() => decide(r, true)}
                    >
                      Duyệt
                    </button>
                    <button
                      className="adm-btn adm-btn-danger"
                      disabled={busyId === r.id}
                      onClick={() => decide(r, false)}
                    >
                      Từ chối
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </AdminShell>
  );
}
