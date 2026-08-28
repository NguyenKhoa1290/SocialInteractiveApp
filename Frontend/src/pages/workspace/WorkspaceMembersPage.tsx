import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { workspaceApi } from "../../api/workspaceApi";
import { chatApi } from "../../api/chatApi";
import { useAuthStore } from "../../store/authStore";
import { extractApiError } from "../../lib/apiError";
import { AppShell } from "../../components/AppShell";
import type { Workspace, WorkspaceMember } from "../../types/workspace";
import "./workspace.css";

const roleLabel: Record<string, string> = {
  leader: "Trưởng nhóm",
  deputy: "Phó nhóm",
  member: "Nhóm viên",
};

export function WorkspaceMembersPage() {
  const { id } = useParams();
  const workspaceId = Number(id);
  const navigate = useNavigate();
  const currentUserId = useAuthStore((s) => s.user?.id);

  const [workspace, setWorkspace] = useState<Workspace | null>(null);
  const [members, setMembers] = useState<WorkspaceMember[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [newMemberId, setNewMemberId] = useState("");
  const [busy, setBusy] = useState(false);

  async function load() {
    try {
      const [wsRes, membersRes] = await Promise.all([
        workspaceApi.get(workspaceId),
        workspaceApi.listMembers(workspaceId),
      ]);
      setWorkspace(wsRes.data);
      setMembers(membersRes.data);
    } catch (err) {
      setError(extractApiError(err, "Không tải được thông tin nhóm"));
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workspaceId]);

  const me = members?.find((m) => m.userId === currentUserId);
  const isLeader = me?.role === "leader";
  const canManage = me?.role === "leader" || me?.role === "deputy";

  // Group conversation duoc tao TU DONG boi backend khi workspace tao
  // (POST /internal/conversations/group, xem WorkSpace Service) - Frontend
  // khong biet truoc conversationId, phai tim trong danh sach cua chinh
  // minh theo workspaceId (GET /conversations da tra ve workspaceId).
  async function handleOpenGroupChat() {
    setBusy(true);
    setError(null);
    try {
      const { data } = await chatApi.listConversations();
      const groupConv = data.find((c) => c.type === "group" && c.workspaceId === workspaceId);
      if (!groupConv) {
        setError("Chưa tìm thấy cuộc trò chuyện nhóm này");
        return;
      }
      navigate(`/app/chat/${groupConv.id}`);
    } catch (err) {
      setError(extractApiError(err, "Không mở được chat nhóm"));
    } finally {
      setBusy(false);
    }
  }

  async function handleAddMember(e: React.FormEvent) {
    e.preventDefault();
    const userId = Number(newMemberId);
    if (!userId) return;
    setBusy(true);
    setError(null);
    try {
      await workspaceApi.addMember(workspaceId, userId);
      setNewMemberId("");
      await load();
    } catch (err) {
      setError(extractApiError(err, "Không thêm được thành viên"));
    } finally {
      setBusy(false);
    }
  }

  async function handleRemove(userId: number) {
    setBusy(true);
    setError(null);
    try {
      await workspaceApi.removeMember(workspaceId, userId);
      if (userId === currentUserId) {
        navigate("/workspaces");
        return;
      }
      await load();
    } catch (err) {
      setError(extractApiError(err, "Không thực hiện được"));
    } finally {
      setBusy(false);
    }
  }

  async function handleRoleChange(userId: number, role: "deputy" | "member") {
    setBusy(true);
    setError(null);
    try {
      await workspaceApi.updateRole(workspaceId, userId, role);
      await load();
    } catch (err) {
      setError(extractApiError(err, "Không đổi được vai trò"));
    } finally {
      setBusy(false);
    }
  }

  if (!workspace || !members) {
    return (
      <AppShell activeTab="groups">
        <Link to="/workspaces" className="ws-back-link">
          ← Về danh sách nhóm
        </Link>
        {error ? <p className="ws-error">{error}</p> : <p>Đang tải...</p>}
      </AppShell>
    );
  }

  return (
    <AppShell>
      <Link to="/workspaces" className="ws-back-link">
        ← Về danh sách nhóm
      </Link>

      <div className="ws-page-header">
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <div className="ws-avatar">
            {workspace.avatarUrl ? <img src={workspace.avatarUrl} alt="" /> : workspace.name.charAt(0).toUpperCase()}
          </div>
          <h1>{workspace.name}</h1>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <button className="ws-btn-primary" disabled={busy} onClick={handleOpenGroupChat}>
            Vào chat nhóm
          </button>
          {canManage && (
            <button className="ws-btn-secondary" onClick={() => navigate(`/workspaces/${workspaceId}/settings`)}>
              Cài đặt nhóm
            </button>
          )}
        </div>
      </div>

      {error && <p className="ws-error">{error}</p>}

      <div className="ws-section">
        <h2>Thành viên ({members.length})</h2>
        {members.map((m) => (
          <div key={m.userId} className="ws-member-row">
            <div className="ws-member-info">
              <div className="ws-avatar" style={{ width: 32, height: 32, fontSize: 13 }}>
                {m.nickname.charAt(0).toUpperCase()}
              </div>
              <div>
                <div>{m.nickname}</div>
                <span className="ws-role-badge">{roleLabel[m.role] ?? m.role}</span>
              </div>
            </div>
            <div className="ws-member-actions">
              {isLeader && m.role === "member" && (
                <button disabled={busy} onClick={() => handleRoleChange(m.userId, "deputy")}>
                  Phong Phó nhóm
                </button>
              )}
              {isLeader && m.role === "deputy" && (
                <button disabled={busy} onClick={() => handleRoleChange(m.userId, "member")}>
                  Xoá phong hàm
                </button>
              )}
              {isLeader && m.userId !== currentUserId && m.role !== "leader" && (
                <button disabled={busy} onClick={() => handleRemove(m.userId)}>
                  Kick
                </button>
              )}
              {m.userId === currentUserId && m.role !== "leader" && (
                <button disabled={busy} onClick={() => handleRemove(m.userId)}>
                  Rời nhóm
                </button>
              )}
            </div>
          </div>
        ))}
      </div>

      {canManage && (
        <div className="ws-section">
          <h2>Thêm thành viên</h2>
          <form onSubmit={handleAddMember} style={{ display: "flex", gap: 8 }}>
            <input
              placeholder="User ID"
              value={newMemberId}
              onChange={(e) => setNewMemberId(e.target.value)}
              className="ws-input"
              style={{ marginBottom: 0 }}
              required
            />
            <button type="submit" disabled={busy} className="ws-btn-primary">
              Thêm
            </button>
          </form>
        </div>
      )}
    </AppShell>
  );
}
