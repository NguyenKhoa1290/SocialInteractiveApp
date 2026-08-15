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
  -- Them ngoai schema goc - E2EE cho tin nhan Text (tu de xuat, tai lieu goc
  -- chi ghi ten "E2EE" khong co co che cu the). content_nonce la nonce/IV
  -- AES-GCM base64, BAT BUOC khi is_encrypted=true. Voi type != 'text',
  -- content van la plaintext nhu truoc (URL/metadata file, khong phai noi
  -- dung nhay cam can ma hoa).
  is_encrypted     BOOLEAN NOT NULL DEFAULT false,
  content_nonce    VARCHAR(64),
  is_deleted       BOOLEAN NOT NULL DEFAULT false,
  -- Them ngoai schema goc - "sua tin nhan" (PATCH), chi cho phep chinh
  -- sender, trong 1 khung thoi gian gioi han sau khi gui (xem EditWindow o
  -- ConversationEndpoints.cs). Rieng biet voi "thu hoi" (recall) - ca 2 deu
  -- dung is_deleted=false, chi khac edited_at co gia tri hay khong.
  is_edited        BOOLEAN NOT NULL DEFAULT false,
  edited_at        TIMESTAMPTZ,
  -- Them ngoai schema goc - luong THAO LUAN rieng cua tung cuoc hop
  -- (Media Service, meetings.id - logical FK, khac CSDL nen khong rang buoc
  -- duoc bang FK that). NULL = tin nhan cua luong chat CHINH cua nhom.
  -- Co gia tri = tin nhan thuoc thao luan cua cuoc hop do.
  --
  -- CO Y de chung bang messages thay vi tach conversation rieng: file dinh
  -- kem se tu dong tinh vao han muc luu tru cua CHINH nhom do (trigger cong
  -- storage_used_bytes theo conversation_id), dung yeu cau "file cung tinh
  -- vao 2GB tong" ma khong phai viet them logic ke toan nao.
  --
  -- Tin nhan thao luan LUON is_encrypted=false: khach vang lai vao hop bang
  -- link khong co cap khoa E2EE nao, nen luong nay khong the ma hoa dau cuoi
  -- nhu chat nhom. Danh doi da biet va chap nhan.
  meeting_id       BIGINT,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_messages_meeting ON messages(meeting_id, created_at DESC)
  WHERE meeting_id IS NOT NULL;

CREATE INDEX idx_messages_conversation_time
  ON messages(conversation_id, created_at);

-- Tim kiem tin nhan (tu de xuat, tai lieu roadmap muc 6.1 co nhac "Search
-- Chat Service" nhung chua co endpoint cu the). Vi tin nhan Text luon E2EE
-- (content la ciphertext), server KHONG the full-text search truc tiep -
-- dung ky thuat "blind index / searchable encryption": client tu tach tu
-- khoa tu noi dung GOC (truoc khi ma hoa), bam bang HMAC voi 1 search-key
-- rieng (chi client giu, KHONG BAO GIO gui len server) roi gui token da bam
-- kem tin nhan. Server chi luu/so khop token bam, khong bao gio biet duoc
-- tu goc la gi - giu dung nguyen tac E2EE (server khong thay noi dung),
-- van cho phep search vi client tu bam lai tu khoa can tim bang cung
-- search-key khi goi API search.
CREATE TABLE message_search_tokens (
  id           BIGSERIAL PRIMARY KEY,
  message_id   BIGINT NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
  token        VARCHAR(64) NOT NULL
);

CREATE INDEX idx_message_search_tokens_lookup
  ON message_search_tokens(token, message_id);

-- E2EE: danh ba khoa cong khai, moi user 1 khoa (X25519). Khoa rieng tu
-- KHONG BAO GIO gui len server - client tu sinh/luu/bao ve bang PIN cuc bo.
CREATE TABLE user_public_keys (
  user_id      BIGINT PRIMARY KEY,
  public_key   VARCHAR(200) NOT NULL,
  algorithm    VARCHAR(20) NOT NULL DEFAULT 'x25519',
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- E2EE cho Group: 1 tin nhan ma hoa bang 1 khoa phien ngau nhien dung 1 lan;
-- khoa phien do lai duoc ma hoa RIENG cho tung thanh vien bang khoa cong
-- khai cua nguoi do (fan-out, dung pattern chuan Signal/WhatsApp group).
-- Voi P2P KHONG dung bang nay - nguoi gui/nhan tu tinh duoc shared secret
-- qua ECDH (X25519) tu khoa cong khai cua nhau, khong can "phan phoi" gi
-- them.
-- Khoi phuc private key tren thiet bi moi bang PIN 6 so - tu thiet ke,
-- xac nhan voi nguoi dung du an (chap nhan danh doi: PIN 6 so chi co 1
-- trieu kha nang, neu ai do lay duoc dong nay co the brute-force offline -
-- CUNG danh doi ma Messenger/WhatsApp chap nhan, khong co PIN ngan nao
-- chong brute-force tuyet doi). Server KHONG BAO GIO thay PIN hay private
-- key goc - ciphertext duoc client tu ma hoa bang khoa dan xuat tu PIN
-- (PBKDF2 + salt luu kem) truoc khi gui len, chi giai ma duoc lai bang
-- dung PIN do tren bat ky thiet bi nao.
-- Khong co FK toi users - Chat DB la database rieng, khong chung voi
-- Identity DB (dung pattern giong het user_public_keys o tren).
CREATE TABLE user_key_vaults (
  user_id      BIGINT PRIMARY KEY,
  salt         VARCHAR(64) NOT NULL,
  nonce        VARCHAR(64) NOT NULL,
  ciphertext   TEXT NOT NULL,
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE message_recipient_keys (
  id                  BIGSERIAL PRIMARY KEY,
  message_id          BIGINT NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
  recipient_user_id   BIGINT NOT NULL,
  encrypted_key       VARCHAR(200) NOT NULL,
  UNIQUE (message_id, recipient_user_id)
);

CREATE INDEX idx_message_recipient_keys_lookup
  ON message_recipient_keys(message_id, recipient_user_id);

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

-- Yeu cau nap them dung luong - tu thiet ke lai theo yeu cau nguoi dung du
-- an: ban dau Truong nhom tu bam nap la cong luon (khong qua duyet), sau
-- doi thanh Truong nhom GUI YEU CAU, Admin duyet moi thuc su cong dung
-- luong (giong nap tien that can nguoi xac nhan da nhan tien). Admin Service
-- khong co CSDL rieng (la lop dieu phoi) nen bang nay van nam o Chat DB,
-- Admin Service chi goi noi bo qua HTTP (xem AdminService.Api/Services/ChatServiceClient.cs).
CREATE TABLE storage_topup_requests (
  id                  BIGSERIAL PRIMARY KEY,
  conversation_id     BIGINT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  requested_by        BIGINT NOT NULL,
  amount              NUMERIC(12,2) NOT NULL CHECK (amount > 0),
  status              VARCHAR(10) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected')),
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  resolved_at         TIMESTAMPTZ,
  resolved_by         BIGINT
);

CREATE INDEX idx_storage_topup_requests_pending
  ON storage_topup_requests(status) WHERE status = 'pending';

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
  -- Kho luu tru chua file: 'home' = MinIO may nha, 'cloud' = R2/S3.
  -- Chon theo dung luong luc upload (Storage:HomeMaxBytes) roi giu nguyen -
  -- file khong tu di chuyen, nen day la nguon su that duy nhat khi tai ve.
  -- DEFAULT 'home' de moi hang cu van dung sau khi them cot.
  storage_provider VARCHAR(20) NOT NULL DEFAULT 'home',
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
