import { useEffect, useState } from "react";
import { workspaceApi } from "../../api/workspaceApi";
import { Modal } from "../../components/Modal";
import { extractApiError } from "../../lib/apiError";
import type { Workspace } from "../../types/workspace";

export function WorkspaceSettingsDialog({
  workspaceId,
  onBack,
  onSaved,
  onDeleted,
}: {
  workspaceId: number;
  onBack: () => void;
  onSaved: (workspace: Workspace) => void;
  onDeleted: () => void;
}) {
  const [workspace, setWorkspace] = useState<Workspace | null>(null);
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [confirmText, setConfirmText] = useState("");
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setWorkspace(null);
    setError(null);
    void workspaceApi
      .get(workspaceId)
      .then(({ data }) => {
        if (cancelled) return;
        setWorkspace(data);
        setName(data.name);
      })
      .catch((err) => {
        if (!cancelled) setError(extractApiError(err, "Không tải được thông tin nhóm"));
      });
    return () => {
      cancelled = true;
    };
  }, [workspaceId]);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSaving(true);
    try {
      const { data } = await workspaceApi.update(workspaceId, { name: name.trim() });
      onSaved(data);
    } catch (err) {
      setError(extractApiError(err, "Không lưu được thay đổi"));
    } finally {
      setSaving(false);
    }
  }

  async function removeWorkspace() {
    if (!workspace || confirmText !== workspace.name) return;
    setDeleting(true);
    setDeleteError(null);
    try {
      await workspaceApi.remove(workspaceId);
      onDeleted();
    } catch (err) {
      setDeleteError(extractApiError(err, "Không xoá được nhóm"));
    } finally {
      setDeleting(false);
    }
  }

  return (
    <>
      <Modal
        title="Cài đặt nhóm"
        onClose={onBack}
        width={600}
        closeOnEscape={!showDeleteConfirm}
      >
        <button type="button" className="wsd-back" onClick={onBack}>
          <span aria-hidden="true">←</span> Quản lý thành viên
        </button>

        {!workspace ? (
          <p className={error ? "wsd-error" : "wsd-loading"} role={error ? "alert" : undefined}>
            {error ?? "Đang tải…"}
          </p>
        ) : (
          <>
            <form className="wsd-form" onSubmit={save}>
              <label>
                <span>Tên nhóm</span>
                <input value={name} onChange={(e) => setName(e.target.value)} required maxLength={100} />
              </label>
              {error && <p className="wsd-error" role="alert">{error}</p>}
              <div className="wsd-save-row">
                <button type="submit" className="wsd-primary" disabled={saving || name.trim() === ""}>
                  {saving ? "Đang lưu…" : "Lưu thay đổi"}
                </button>
              </div>
            </form>

            <section className="wsd-danger">
              <h3>Xoá nhóm</h3>
              <p>
                Hành động này xoá vĩnh viễn cả nhóm, toàn bộ tin nhắn, file và thành viên; không thể hoàn tác.
              </p>
              <button type="button" onClick={() => setShowDeleteConfirm(true)}>
                Xoá nhóm vĩnh viễn
              </button>
            </section>
          </>
        )}
      </Modal>

      {showDeleteConfirm && workspace && (
        <Modal
          title="Xác nhận xoá nhóm"
          onClose={() => !deleting && setShowDeleteConfirm(false)}
          width={460}
          closeOnEscape={!deleting}
        >
          <p className="wsd-confirm-copy">
            Gõ chính xác tên nhóm <strong>{workspace.name}</strong> để xác nhận xoá vĩnh viễn.
          </p>
          <input
            className="wsd-confirm-input"
            value={confirmText}
            onChange={(e) => setConfirmText(e.target.value)}
            placeholder={workspace.name}
            autoFocus
          />
          {deleteError && <p className="wsd-error" role="alert">{deleteError}</p>}
          <div className="wsd-confirm-actions">
            <button type="button" className="wsd-secondary" onClick={() => setShowDeleteConfirm(false)} disabled={deleting}>
              Huỷ
            </button>
            <button
              type="button"
              className="wsd-delete"
              onClick={() => void removeWorkspace()}
              disabled={deleting || confirmText !== workspace.name}
            >
              {deleting ? "Đang xoá…" : "Xoá vĩnh viễn"}
            </button>
          </div>
        </Modal>
      )}
    </>
  );
}
