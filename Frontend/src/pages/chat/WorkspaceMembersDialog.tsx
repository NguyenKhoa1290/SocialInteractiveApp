import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { useNavigate } from "react-router-dom";
import { workspaceApi } from "../../api/workspaceApi";
import { Avatar } from "../../components/Avatar";
import { Modal } from "../../components/Modal";
import { extractApiError } from "../../lib/apiError";
import { useAuthStore } from "../../store/authStore";
import type { WorkspaceMember } from "../../types/workspace";
import { AddMemberDialog } from "./AddMemberDialog";

const roleLabel: Record<WorkspaceMember["role"], string> = {
  leader: "Trưởng nhóm",
  deputy: "Phó nhóm",
  member: "Thành viên",
};

export function WorkspaceMembersDialog({
  workspaceId,
  onClose,
  onMembersChanged,
}: {
  workspaceId: number;
  onClose: () => void;
  onMembersChanged: (members: WorkspaceMember[]) => void;
}) {
  const navigate = useNavigate();
  const currentUserId = useAuthStore((s) => s.user?.id);
  const [members, setMembers] = useState<WorkspaceMember[] | null>(null);
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showAddMember, setShowAddMember] = useState(false);

  async function load() {
    try {
      const { data } = await workspaceApi.listMembers(workspaceId);
      setMembers(data);
      onMembersChanged(data);
    } catch (err) {
      setMembers([]);
      setError(extractApiError(err, "Không tải được danh sách thành viên"));
    }
  }

  useEffect(() => {
    void load();
    // Callback cua trang cha thay doi theo render, khong phai tin hieu tai lai.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workspaceId]);

  const me = members?.find((member) => member.userId === currentUserId);
  const isLeader = me?.role === "leader";
  const canManage = me?.role === "leader" || me?.role === "deputy";
  const visibleMembers = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!members || !q) return members ?? [];
    return members.filter((member) =>
      member.nickname.toLowerCase().includes(q) || String(member.userId).includes(q),
    );
  }, [members, query]);

  async function changeRole(member: WorkspaceMember, role: "deputy" | "member") {
    setBusy(`role:${member.userId}`);
    setError(null);
    try {
      await workspaceApi.updateRole(workspaceId, member.userId, role);
      await load();
    } catch (err) {
      setError(extractApiError(err, "Không đổi được vai trò"));
    } finally {
      setBusy(null);
    }
  }

  async function removeMember(member: WorkspaceMember) {
    setBusy(`remove:${member.userId}`);
    setError(null);
    try {
      await workspaceApi.removeMember(workspaceId, member.userId);
      if (member.userId === currentUserId) {
        onClose();
        navigate("/app/groups", { replace: true });
        return;
      }
      await load();
    } catch (err) {
      setError(extractApiError(err, "Không thể xóa thành viên"));
    } finally {
      setBusy(null);
    }
  }

  return createPortal(
    <>
      <Modal title="Quản lý thành viên" onClose={onClose} width={760} closeOnEscape={!showAddMember}>
        <div className="wmd-toolbar">
          <label className="wmd-search">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <circle cx="10.5" cy="10.5" r="6.8" stroke="currentColor" strokeWidth="2.2" />
              <path d="m15.6 15.6 4.6 4.6" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />
            </svg>
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Tìm thành viên"
              aria-label="Tìm thành viên"
              autoFocus
            />
          </label>
          {canManage && (
            <div className="wmd-toolbar-actions">
              <button type="button" className="cw-pill wmd-add" onClick={() => setShowAddMember(true)}>
                Thêm thành viên
              </button>
              <button
                type="button"
                className="cw-pill wmd-settings"
                onClick={() => navigate(`/workspaces/${workspaceId}/settings`)}
              >
                Cài đặt nhóm
              </button>
            </div>
          )}
        </div>

        {error && <p className="wmd-error" role="alert">{error}</p>}
        <div className="wmd-summary">
          {members === null ? "Đang tải…" : `${members.length} thành viên`}
        </div>

        <div className="wmd-list">
          {members !== null && visibleMembers.length === 0 && (
            <p className="wmd-empty">Không tìm thấy thành viên phù hợp.</p>
          )}
          {visibleMembers.map((member) => {
            const isMe = member.userId === currentUserId;
            const rowBusy = busy?.endsWith(`:${member.userId}`) === true;
            return (
              <div key={member.userId} className="wmd-row">
                <Avatar userId={member.userId} nickname={member.nickname} avatarUpdatedAt={null} size={52} />
                <div className="wmd-identity">
                  <span className="wmd-name">{member.nickname}{isMe ? " (bạn)" : ""}</span>
                  <span className={`wmd-role wmd-role-${member.role}`}>{roleLabel[member.role]}</span>
                </div>
                <div className="wmd-actions">
                  {isLeader && member.role === "member" && (
                    <button type="button" disabled={busy !== null} onClick={() => void changeRole(member, "deputy")}>
                      Phong phó nhóm
                    </button>
                  )}
                  {isLeader && member.role === "deputy" && (
                    <button type="button" disabled={busy !== null} onClick={() => void changeRole(member, "member")}>
                      Gỡ phó nhóm
                    </button>
                  )}
                  {isLeader && !isMe && member.role !== "leader" && (
                    <button
                      type="button"
                      className="wmd-danger"
                      disabled={busy !== null}
                      onClick={() => void removeMember(member)}
                    >
                      {rowBusy ? "Đang xóa…" : "Xóa"}
                    </button>
                  )}
                  {isMe && member.role !== "leader" && (
                    <button
                      type="button"
                      className="wmd-danger"
                      disabled={busy !== null}
                      onClick={() => void removeMember(member)}
                    >
                      {rowBusy ? "Đang rời…" : "Rời nhóm"}
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </Modal>

      {showAddMember && members && (
        <AddMemberDialog
          workspaceId={workspaceId}
          members={members.map((member) => ({ userId: member.userId, nickname: member.nickname }))}
          onClose={() => setShowAddMember(false)}
          onAdded={() => void load()}
        />
      )}
    </>,
    document.body,
  );
}
