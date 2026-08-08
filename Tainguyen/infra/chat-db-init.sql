-- Schema Chat/Social DB - dung theo muc 6.2 cua
-- Congviec/he-thong-tong-hop-kien-truc-csdl-api-roadmap.md
-- Dung chung cho ca P2P va Group (Phase 2 chi dung nhanh 'p2p' cua conversations,
-- cac bang group_chat_settings/muted_members danh cho Phase 3 nhung tao san
-- vi cung 1 schema thong nhat, khong tach rieng theo phase).

CREATE TABLE conversations (
  id                 BIGSERIAL PRIMARY KEY,
  type               VARCHAR(10) NOT NULL CHECK (type IN ('p2p','group')),
  workspace_id       BIGINT,
  participant_a_id   BIGINT,
  participant_b_id   BIGINT,
  last_message_at    TIMESTAMPTZ,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT chk_conversation_shape CHECK (
    (type = 'p2p'   AND workspace_id IS NULL
                    AND participant_a_id IS NOT NULL
                    AND participant_b_id IS NOT NULL)
    OR
    (type = 'group' AND workspace_id IS NOT NULL
                    AND participant_a_id IS NULL
                    AND participant_b_id IS NULL)
  )
);

CREATE UNIQUE INDEX idx_conversations_p2p_pair
  ON conversations (
    LEAST(participant_a_id, participant_b_id),
    GREATEST(participant_a_id, participant_b_id)
  ) WHERE type = 'p2p';

CREATE UNIQUE INDEX idx_conversations_one_per_workspace
  ON conversations (workspace_id) WHERE type = 'group';

CREATE INDEX idx_conversations_last_message_p2p
  ON conversations(last_message_at) WHERE type = 'p2p';

CREATE TABLE messages (
  id               BIGSERIAL PRIMARY KEY,
  conversation_id  BIGINT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  sender_id        BIGINT,
  type             VARCHAR(20) NOT NULL
                     CHECK (type IN ('text','image','video','file','voice','vote','system')),
  content          TEXT,
  is_deleted       BOOLEAN NOT NULL DEFAULT false,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_messages_conversation_time
  ON messages(conversation_id, created_at);

CREATE TABLE group_chat_settings (
  conversation_id       BIGINT PRIMARY KEY REFERENCES conversations(id) ON DELETE CASCADE,
  plan                  VARCHAR(10) NOT NULL DEFAULT 'free' CHECK (plan IN ('free','paid')),
  storage_quota_bytes   BIGINT NOT NULL DEFAULT 2147483648,
  storage_used_bytes    BIGINT NOT NULL DEFAULT 0 CHECK (storage_used_bytes >= 0),
  is_locked             BOOLEAN NOT NULL DEFAULT false,
  storage_expires_at    TIMESTAMPTZ,
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- Them ngoai schema goc trong tai lieu roadmap (Phase 3) - theo doi da gui
  -- canh bao xoa file o moc nao (3d/2d/1d/10h), tranh gui trung lap.
  last_warning_stage    VARCHAR(20)
);

CREATE TABLE muted_members (
  id               BIGSERIAL PRIMARY KEY,
  conversation_id  BIGINT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  user_id          BIGINT NOT NULL,
  muted_by         BIGINT NOT NULL,
  muted_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (conversation_id, user_id)
);

CREATE TABLE files (
  id               BIGSERIAL PRIMARY KEY,
  conversation_id  BIGINT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  message_id       BIGINT REFERENCES messages(id) ON DELETE CASCADE,
  uploaded_by      BIGINT NOT NULL,
  object_key       VARCHAR(500) NOT NULL,
  file_type        VARCHAR(20) NOT NULL
                     CHECK (file_type IN ('image','video','voice','file')),
  size_bytes       BIGINT NOT NULL,
  uploaded_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_files_conversation ON files(conversation_id);

-- Trigger: tu dong cong/tru storage_used_bytes khi them/xoa file,
-- tranh phai tu tinh toan roi rac o tang ung dung (de bi lech).
CREATE OR REPLACE FUNCTION sync_storage_used()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    UPDATE group_chat_settings
      SET storage_used_bytes = storage_used_bytes + NEW.size_bytes,
          updated_at = now()
      WHERE conversation_id = NEW.conversation_id;
    RETURN NEW;
  ELSIF TG_OP = 'DELETE' THEN
    UPDATE group_chat_settings
      SET storage_used_bytes = storage_used_bytes - OLD.size_bytes,
          updated_at = now()
      WHERE conversation_id = OLD.conversation_id;
    RETURN OLD;
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_files_insert_sync_storage
  AFTER INSERT ON files
  FOR EACH ROW EXECUTE FUNCTION sync_storage_used();

CREATE TRIGGER trg_files_delete_sync_storage
  AFTER DELETE ON files
  FOR EACH ROW EXECUTE FUNCTION sync_storage_used();
