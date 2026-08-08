-- Schema Workspace DB - dung theo muc 5.2 cua
-- Congviec/he-thong-tong-hop-kien-truc-csdl-api-roadmap.md

CREATE TABLE workspaces (
  id           BIGSERIAL PRIMARY KEY,
  name         VARCHAR(100) NOT NULL,
  avatar_url   VARCHAR(500),
  created_by   BIGINT NOT NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE workspace_members (
  id            BIGSERIAL PRIMARY KEY,
  workspace_id  BIGINT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  user_id       BIGINT NOT NULL,
  role          VARCHAR(20) NOT NULL DEFAULT 'member'
                  CHECK (role IN ('leader','deputy','member')),
  invited_by    BIGINT,
  joined_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, user_id)
);

CREATE UNIQUE INDEX idx_workspace_one_leader
  ON workspace_members(workspace_id) WHERE role = 'leader';

-- Truong nhom roi nhom = giai tan toan bo nhom (quyet dinh da chot).
-- Xoa dong membership cua Truong nhom se tu dong cascade xoa
-- luon bang workspaces, keo theo toan bo thanh vien khac qua
-- ON DELETE CASCADE co san o workspace_members.workspace_id.
-- Ve ban chat, "Truong nhom tu roi nhom" va "Xoa nhom" (UC-19)
-- gio dung chung 1 co che, cho ra cung 1 ket qua.
CREATE OR REPLACE FUNCTION cascade_delete_workspace_on_leader_leave()
RETURNS TRIGGER AS $$
BEGIN
  IF OLD.role = 'leader' THEN
    DELETE FROM workspaces WHERE id = OLD.workspace_id;
  END IF;
  RETURN OLD;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_cascade_delete_workspace_on_leader_leave
  AFTER DELETE ON workspace_members
  FOR EACH ROW EXECUTE FUNCTION cascade_delete_workspace_on_leader_leave();
