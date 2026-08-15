import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { adminApi } from "../../api/adminApi";
import { extractApiError } from "../../lib/apiError";
import { AdminShell } from "./AdminShell";
import { formatDateTime } from "./format";
import type { SpamViolation } from "../../types/admin";

const PAGE_SIZE = 20;

export function AdminViolationsPage() {
  const [data, setData] = useState<{ items: SpamViolation[]; total: number } | null>(null);
  const [page, setPage] = useState(1);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    setError(null);
    adminApi
      .listViolations(page, PAGE_SIZE)
      .then((res) => setData({ items: res.data.items, total: res.data.total }))
      .catch((err) => setError(extractApiError(err, "Không tải được danh sách vi phạm")));
  }, [page]);

  useEffect(load, [load]);

  const totalPages = data ? Math.max(1, Math.ceil(data.total / PAGE_SIZE)) : 1;

  return (
    <AdminShell title="Vi phạm spam">
      {error && <p className="adm-error">{error}</p>}
      {data === null && !error && <p className="adm-muted">Đang tải...</p>}

      {data !== null && data.items.length === 0 && (
        <p className="adm-empty">Chưa ghi nhận vi phạm nào.</p>
      )}

      {data !== null && data.items.length > 0 && (
        <>
          <div className="adm-table-wrap">
            <table className="adm-table">
              <thead>
                <tr>
                  <th>User</th>
                  <th>Phát hiện lúc</th>
                  <th>Lý do</th>
                  <th>Trạng thái tài khoản</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {/* Khong dung userId lam key: 1 user co the co nhieu vi pham,
                    key trung nhau se lam React dung nham hang khi doi trang. */}
                {data.items.map((v, i) => (
                  <tr key={`${v.userId}-${v.detectedAt}-${i}`}>
                    <td>
                      {v.nickname} <span className="adm-mono adm-muted">#{v.userId}</span>
                    </td>
                    <td className="adm-muted">{formatDateTime(v.detectedAt)}</td>
                    <td>{v.reason}</td>
                    <td>
                      <span
                        className={`adm-badge ${v.accountStatus === "locked" ? "adm-badge-locked" : "adm-badge-active"}`}
                      >
                        {v.accountStatus === "locked" ? "Bị khoá" : "Hoạt động"}
                      </span>
                    </td>
                    <td>
                      <Link to="/admin/users" className="adm-link-plain">
                        Xem ở mục Người dùng
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="adm-pager">
            <button className="adm-btn adm-btn-ghost" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
              ← Trước
            </button>
            <span className="adm-muted">
              Trang {page}/{totalPages} · {data.total} vi phạm
            </span>
            <button
              className="adm-btn adm-btn-ghost"
              disabled={page >= totalPages}
              onClick={() => setPage((p) => p + 1)}
            >
              Sau →
            </button>
          </div>
        </>
      )}
    </AdminShell>
  );
}
