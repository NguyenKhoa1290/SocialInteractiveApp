import { useCallback, useEffect, useState } from "react";
import { adminApi } from "../../api/adminApi";
import { extractApiError } from "../../lib/apiError";
import { AdminShell } from "./AdminShell";
import { formatDateTime } from "./format";
import type { AdminUserDetail, AdminUserInfo } from "../../types/admin";

const PAGE_SIZE = 20;

export function AdminUsersPage() {
  const [data, setData] = useState<{ items: AdminUserInfo[]; total: number } | null>(null);
  const [page, setPage] = useState(1);
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [error, setError] = useState<string | null>(null);

  const [selected, setSelected] = useState<AdminUserDetail | null>(null);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(() => {
    setError(null);
    adminApi
      .listUsers(page, PAGE_SIZE, search || undefined)
      .then((res) => setData({ items: res.data.items, total: res.data.total }))
      .catch((err) => setError(extractApiError(err, "Không tải được danh sách người dùng")));
  }, [page, search]);

  useEffect(load, [load]);

  function submitSearch(e: React.FormEvent) {
    e.preventDefault();
    setPage(1); // ve trang 1: giu nguyen trang cu se ra rong neu ket qua moi it hon
    setSearch(searchInput.trim());
  }

  function openDetail(userId: number) {
    setDetailError(null);
    setNotice(null);
    setSelected(null);
    adminApi
      .getUser(userId)
      .then((res) => setSelected(res.data))
      .catch((err) => setDetailError(extractApiError(err, "Không tải được chi tiết người dùng")));
  }

  async function handleUnlock(userId: number) {
    setBusy(true);
    setDetailError(null);
    try {
      await adminApi.unlockUser(userId);
      setNotice("Đã gỡ khoá tài khoản.");
      openDetail(userId);
      load();
    } catch (err) {
      setDetailError(extractApiError(err, "Gỡ khoá thất bại"));
    } finally {
      setBusy(false);
    }
  }

  async function handleDelete(user: AdminUserDetail) {
    if (!window.confirm(`Xoá vĩnh viễn tài khoản "${user.nickname}"? Không thể hoàn tác.`)) return;
    setBusy(true);
    setDetailError(null);
    try {
      await adminApi.deleteUser(user.id);
      // 202 chu khong phai 204: yeu cau di qua RabbitMQ, Identity Service
      // xoa that sau do. Noi dung thong bao phai phan anh dung dieu nay,
      // khong duoc hua "da xoa xong".
      setNotice("Đã gửi yêu cầu xoá. Tài khoản sẽ biến mất sau khi Identity Service xử lý xong.");
      setSelected(null);
      load();
    } catch (err) {
      setDetailError(extractApiError(err, "Không gửi được yêu cầu xoá"));
    } finally {
      setBusy(false);
    }
  }

  const totalPages = data ? Math.max(1, Math.ceil(data.total / PAGE_SIZE)) : 1;

  return (
    <AdminShell title="Người dùng">
      <form onSubmit={submitSearch} className="adm-searchbar">
        <input
          value={searchInput}
          onChange={(e) => setSearchInput(e.target.value)}
          placeholder="Tìm theo biệt danh hoặc email..."
          className="adm-input"
        />
        <button type="submit" className="adm-btn adm-btn-primary">
          Tìm
        </button>
        {search && (
          <button
            type="button"
            className="adm-btn adm-btn-ghost"
            onClick={() => {
              setSearchInput("");
              setSearch("");
              setPage(1);
            }}
          >
            Xoá lọc
          </button>
        )}
      </form>

      {error && <p className="adm-error">{error}</p>}
      {notice && <p className="adm-notice">{notice}</p>}

      {data === null && !error && <p className="adm-muted">Đang tải...</p>}

      {data !== null && data.items.length === 0 && (
        <p className="adm-empty">
          {search ? `Không có người dùng nào khớp "${search}".` : "Chưa có người dùng nào."}
        </p>
      )}

      {data !== null && data.items.length > 0 && (
        <>
          <div className="adm-table-wrap">
            <table className="adm-table">
              <thead>
                <tr>
                  <th>ID</th>
                  <th>Biệt danh</th>
                  <th>Email</th>
                  <th>Loại</th>
                  <th>Trạng thái</th>
                  <th>Hoạt động lần cuối</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {data.items.map((u) => (
                  <tr key={u.id} className={selected?.id === u.id ? "selected" : undefined}>
                    <td className="adm-mono">{u.id}</td>
                    <td>
                      {u.nickname}
                      {u.isAdmin && <span className="adm-badge adm-badge-admin">Admin</span>}
                    </td>
                    <td className="adm-muted">{u.email ?? "—"}</td>
                    <td>{u.userType === "guest" ? "Khách" : "Đã đăng ký"}</td>
                    <td>
                      <span className={`adm-badge ${u.status === "locked" ? "adm-badge-locked" : "adm-badge-active"}`}>
                        {u.status === "locked" ? "Bị khoá" : "Hoạt động"}
                      </span>
                    </td>
                    <td className="adm-muted">{formatDateTime(u.lastActiveAt)}</td>
                    <td>
                      <button className="adm-btn adm-btn-ghost" onClick={() => openDetail(u.id)}>
                        Chi tiết
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="adm-pager">
            <button
              className="adm-btn adm-btn-ghost"
              disabled={page <= 1}
              onClick={() => setPage((p) => p - 1)}
            >
              ← Trước
            </button>
            <span className="adm-muted">
              Trang {page}/{totalPages} · {data.total} người dùng
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

      {detailError && <p className="adm-error">{detailError}</p>}

      {selected && (
        <section className="adm-panel">
          <div className="adm-panel-head">
            <h2>
              {selected.nickname} <span className="adm-mono adm-muted">#{selected.id}</span>
            </h2>
            <button className="adm-btn adm-btn-ghost" onClick={() => setSelected(null)}>
              Đóng
            </button>
          </div>

          <dl className="adm-kv">
            <dt>Email</dt>
            <dd>{selected.email ?? "—"}</dd>
            <dt>Loại tài khoản</dt>
            <dd>{selected.userType === "guest" ? "Khách vãng lai" : "Đã đăng ký"}</dd>
            <dt>Trạng thái</dt>
            <dd>{selected.status === "locked" ? "Bị khoá" : "Hoạt động"}</dd>
            <dt>Tạo lúc</dt>
            <dd>{formatDateTime(selected.createdAt)}</dd>
            <dt>Hoạt động lần cuối</dt>
            <dd>{formatDateTime(selected.lastActiveAt)}</dd>
          </dl>

          <h3 className="adm-subtitle">Vi phạm spam ({selected.violations.length})</h3>
          {selected.violations.length === 0 ? (
            <p className="adm-muted">Không có vi phạm nào.</p>
          ) : (
            <ul className="adm-violations">
              {selected.violations.map((v, i) => (
                <li key={i}>
                  <span className="adm-muted">{formatDateTime(v.detectedAt)}</span>
                  <span>{v.reason}</span>
                </li>
              ))}
            </ul>
          )}

          <div className="adm-panel-actions">
            {selected.status === "locked" && (
              <button
                className="adm-btn adm-btn-primary"
                disabled={busy}
                onClick={() => handleUnlock(selected.id)}
              >
                Gỡ khoá tài khoản
              </button>
            )}
            <button
              className="adm-btn adm-btn-danger"
              disabled={busy}
              onClick={() => handleDelete(selected)}
            >
              Xoá vĩnh viễn
            </button>
          </div>
          <p className="adm-hint">
            Không xoá được nếu tài khoản còn khiếu nại chưa xử lý — xử lý ở mục Khiếu nại trước.
          </p>
        </section>
      )}
    </AdminShell>
  );
}
