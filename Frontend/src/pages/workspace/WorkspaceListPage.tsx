import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { workspaceApi } from "../../api/workspaceApi";
import { useAuthStore } from "../../store/authStore";
import { extractApiError } from "../../lib/apiError";
import { AppShell } from "../../components/AppShell";
import type { WorkspaceSummary } from "../../types/workspace";
import "./workspace.css";

const roleLabel: Record<string, string> = {
  leader: "Trưởng nhóm",
  deputy: "Phó nhóm",
  member: "Nhóm viên",
};

export function WorkspaceListPage() {
  // Khach khong tao duoc nhom (UC-17, da chot): tai khoan Guest bi xoa sau 6
  // thang khong hoat dong, ma Truong nhom roi nhom = giai tan ca nhom.
  const laKhach = useAuthStore((s) => s.user?.userType) === "guest";
  const [items, setItems] = useState<WorkspaceSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    workspaceApi
      .listMine()
      .then((res) => setItems(res.data))
      .catch((err) => setError(extractApiError(err, "Không tải được danh sách nhóm")));
  }, []);

  return (
    <AppShell activeTab="groups">
      <div className="ws-page-header">
        <h1>Nhóm của tôi</h1>
        {!laKhach && (
          <Link to="/workspaces/new" className="ws-btn-primary" style={{ textDecoration: "none" }}>
            + Tạo nhóm mới
          </Link>
        )}
      </div>

      {error && <p className="ws-error">{error}</p>}

      {items === null && !error && <p>Đang tải...</p>}

      {items !== null && items.length === 0 && (
        <p className="ws-empty">
          {laKhach
            ? "Bạn chưa tham gia nhóm nào. Tài khoản khách không tạo được nhóm - hãy đăng ký tài khoản, hoặc nhờ một nhóm thêm bạn vào."
            : "Bạn chưa tham gia nhóm nào. Tạo nhóm đầu tiên của bạn!"}
        </p>
      )}

      <div className="ws-list">
        {items?.map((ws) => (
          <Link key={ws.id} to={`/workspaces/${ws.id}`} className="ws-card">
            <div className="ws-avatar">
              {ws.avatarUrl ? <img src={ws.avatarUrl} alt="" /> : ws.name.charAt(0).toUpperCase()}
            </div>
            <div>
              <div className="ws-card-name">{ws.name}</div>
              <span className="ws-role-badge">{roleLabel[ws.myRole] ?? ws.myRole}</span>
            </div>
          </Link>
        ))}
      </div>
    </AppShell>
  );
}
