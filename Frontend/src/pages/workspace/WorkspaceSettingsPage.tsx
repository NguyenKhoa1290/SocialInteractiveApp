import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { workspaceApi } from "../../api/workspaceApi";
import { extractApiError } from "../../lib/apiError";
import { AppShell } from "../../components/AppShell";
import type { Workspace } from "../../types/workspace";
import "./workspace.css";

export function WorkspaceSettingsPage() {
  const { id } = useParams();
  const workspaceId = Number(id);
  const navigate = useNavigate();

  const [workspace, setWorkspace] = useState<Workspace | null>(null);
  const [name, setName] = useState("");
  const [avatarUrl, setAvatarUrl] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [confirmText, setConfirmText] = useState("");
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    workspaceApi
      .get(workspaceId)
      .then((res) => {
        setWorkspace(res.data);
        setName(res.data.name);
        setAvatarUrl(res.data.avatarUrl ?? "");
      })
      .catch((err) => setError(extractApiError(err, "Không tải được thông tin nhóm")));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workspaceId]);

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSaving(true);
    try {
      await workspaceApi.update(workspaceId, { name, avatarUrl: avatarUrl || undefined });
      navigate(`/workspaces/${workspaceId}`);
    } catch (err) {
      setError(extractApiError(err, "Không lưu được thay đổi"));
    } finally {
      setSaving(false);
    }
  }

  // Xoa nhom (UC-19) - PHA HUY DU LIEU LON NHAT he thong, khong hoan tac.
  // Bat buoc go dung ten nhom moi cho phep bam nut xoa that su (tai lieu
  // dac ta frontend muc 5: "khong chi 1 nut Dong y don gian").
  async function handleDelete() {
    if (!workspace || confirmText !== workspace.name) return;
    setDeleting(true);
    setDeleteError(null);
    try {
      await workspaceApi.remove(workspaceId);
      navigate("/workspaces");
    } catch (err) {
      setDeleteError(extractApiError(err, "Không xoá được nhóm"));
    } finally {
      setDeleting(false);
    }
  }

  if (!workspace) {
    return (
      <AppShell>
        {error ? <p className="ws-error">{error}</p> : <p>Đang tải...</p>}
      </AppShell>
    );
  }

  return (
    <AppShell>
      <Link to={`/workspaces/${workspaceId}`} className="ws-back-link">
        ← Về nhóm
      </Link>

      <div className="ws-page-header">
        <h1>Cài đặt nhóm</h1>
      </div>

      <form onSubmit={handleSave} style={{ maxWidth: 400 }}>
        <input value={name} onChange={(e) => setName(e.target.value)} required maxLength={100} className="ws-input" />
        <input
          placeholder="URL avatar"
          value={avatarUrl}
          onChange={(e) => setAvatarUrl(e.target.value)}
          className="ws-input"
        />
        {error && <p className="ws-error">{error}</p>}
        <button type="submit" disabled={saving} className="ws-btn-primary">
          {saving ? "Đang lưu..." : "Lưu thay đổi"}
        </button>
      </form>

      <div className="ws-danger-box">
        <h2 style={{ fontSize: 15, margin: "0 0 8px" }}>Xoá nhóm</h2>
        <p>
          Hành động này xoá <strong>vĩnh viễn</strong> cả nhóm, toàn bộ tin nhắn, file và thành viên —
          không thể hoàn tác.
        </p>
        <button className="ws-btn-danger" onClick={() => setShowDeleteModal(true)}>
          Xoá nhóm vĩnh viễn
        </button>
      </div>

      {showDeleteModal && (
        <div className="ws-modal-overlay" onClick={() => !deleting && setShowDeleteModal(false)}>
          <div className="ws-modal" onClick={(e) => e.stopPropagation()}>
            <h2>Xác nhận xoá nhóm</h2>
            <p>
              Gõ lại chính xác tên nhóm <strong>{workspace.name}</strong> để xác nhận xoá vĩnh viễn.
            </p>
            <input
              className="ws-input"
              value={confirmText}
              onChange={(e) => setConfirmText(e.target.value)}
              placeholder={workspace.name}
              autoFocus
            />
            {deleteError && <p className="ws-error">{deleteError}</p>}
            <div className="ws-modal-actions">
              <button className="ws-btn-secondary" onClick={() => setShowDeleteModal(false)} disabled={deleting}>
                Huỷ
              </button>
              <button
                className="ws-btn-danger"
                onClick={handleDelete}
                disabled={deleting || confirmText !== workspace.name}
              >
                {deleting ? "Đang xoá..." : "Xoá vĩnh viễn"}
              </button>
            </div>
          </div>
        </div>
      )}
    </AppShell>
  );
}
