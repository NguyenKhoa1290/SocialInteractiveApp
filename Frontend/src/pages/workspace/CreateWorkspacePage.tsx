import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { workspaceApi } from "../../api/workspaceApi";
import { extractApiError } from "../../lib/apiError";
import { AppShell } from "../../components/AppShell";
import "./workspace.css";

export function CreateWorkspacePage() {
  const navigate = useNavigate();
  const [name, setName] = useState("");
  const [avatarUrl, setAvatarUrl] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const { data } = await workspaceApi.create(name, avatarUrl || undefined);
      navigate(`/workspaces/${data.id}`);
    } catch (err) {
      setError(extractApiError(err, "Không tạo được nhóm"));
    } finally {
      setLoading(false);
    }
  }

  return (
    <AppShell>
      <div className="ws-page-header">
        <h1>Tạo nhóm mới</h1>
      </div>
      <form onSubmit={handleSubmit} style={{ maxWidth: 400 }}>
        <input
          placeholder="Tên nhóm"
          value={name}
          onChange={(e) => setName(e.target.value)}
          required
          maxLength={100}
          className="ws-input"
        />
        <input
          placeholder="URL avatar (tuỳ chọn)"
          value={avatarUrl}
          onChange={(e) => setAvatarUrl(e.target.value)}
          className="ws-input"
        />
        {error && <p className="ws-error">{error}</p>}
        <button type="submit" disabled={loading} className="ws-btn-primary">
          {loading ? "Đang tạo..." : "Tạo nhóm"}
        </button>
      </form>
    </AppShell>
  );
}
