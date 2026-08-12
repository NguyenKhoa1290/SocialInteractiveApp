-- Schema Identity DB - dung dung theo muc 3.2 cua
-- Congviec/he-thong-tong-hop-kien-truc-csdl-api-roadmap.md
-- Tu dong chay 1 lan duy nhat khi container Postgres khoi tao lan dau
-- (co che chuan cua image postgres: cac file trong /docker-entrypoint-initdb.d/).

CREATE TABLE users (
  id              BIGSERIAL PRIMARY KEY,
  user_type       VARCHAR(20) NOT NULL
                    CHECK (user_type IN ('guest','registered')),
  nickname        VARCHAR(50) NOT NULL,
  email           VARCHAR(255) UNIQUE,
  password_hash   VARCHAR(255),
  status          VARCHAR(20) NOT NULL DEFAULT 'active'
                    CHECK (status IN ('active','locked')),
  -- Them o Phase 4 (Admin Service, ALTER TABLE tren instance dang chay, khong
  -- co trong ban thiet ke goc). Chua co UI/luong dang ky Admin nao duoc dinh
  -- nghia trong tai lieu goc, nen viec cap quyen admin hien tai la thao tac
  -- thu cong (UPDATE users SET is_admin = true) hoac qua internal endpoint
  -- POST /internal/users/{userId}/promote-admin (chi dung noi bo/CLI, KHONG
  -- public) - xem InternalEndpoints.cs.
  is_admin        BOOLEAN NOT NULL DEFAULT false,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_active_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT chk_guest_no_credentials
    CHECK (user_type <> 'guest' OR (email IS NULL AND password_hash IS NULL))
);

CREATE INDEX idx_users_email
  ON users(email) WHERE email IS NOT NULL;

-- Nickname phai duy nhat toan he thong (khong phan biet hoa/thuong) - tu bo
-- sung khi them tinh nang ban be (tim theo nickname, xem FriendsEndpoints.cs):
-- neu trung nickname, ket qua tim kiem se lan lon giua nhieu nguoi khac
-- nhau. Ap dung cho CA Guest lan Registered - Guest chiem 1 nickname thi
-- nguoi khac (ke ca dang ky that) khong dung duoc cho toi khi Guest do bi
-- don dep (6 thang khong hoat dong, xem GuestCleanupService).
CREATE UNIQUE INDEX idx_users_nickname_lower
  ON users (LOWER(nickname));

CREATE INDEX idx_users_last_active
  ON users(last_active_at) WHERE user_type = 'guest';

CREATE TABLE oauth_links (
  id                 BIGSERIAL PRIMARY KEY,
  user_id            BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  provider           VARCHAR(20) NOT NULL
                       CHECK (provider IN ('google','facebook')),
  provider_user_id   VARCHAR(255) NOT NULL,
  linked_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (provider, provider_user_id),
  UNIQUE (user_id, provider)
);

-- Tinh nang "ban be" - them ngoai schema goc, tai lieu roadmap goc co nhac
-- toi (Media Service, muc moi hop) nhung CHUA TUNG duoc thiet ke o bat ky
-- service nao (xem roadmap muc 7.4 "Quyet dinh tu dua ra"). Tu thiet ke khi
-- Frontend can toi (F1.5): co che gui loi moi + doi phuong dong y, giong
-- Facebook/Zalo - KHONG them ngay lap tuc de tranh spam ket ban hang loat.
-- 1 dong = 1 cap quan he, status 'pending' -> 'accepted' (KHONG dung
-- 'rejected' - tu choi/huy loi moi thi xoa thang dong, cho phep gui lai
-- sau nay).
CREATE TABLE friendships (
  id             BIGSERIAL PRIMARY KEY,
  requester_id   BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  addressee_id   BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status         VARCHAR(10) NOT NULL DEFAULT 'pending'
                   CHECK (status IN ('pending','accepted')),
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  responded_at   TIMESTAMPTZ,
  CONSTRAINT chk_friendship_not_self CHECK (requester_id <> addressee_id)
);

-- Chi 1 quan he giua 2 nguoi tai 1 thoi diem, bat ke ai la nguoi gui truoc -
-- cung pattern voi idx_conversations_p2p_pair (chat-db-init.sql).
CREATE UNIQUE INDEX idx_friendships_pair
  ON friendships (
    LEAST(requester_id, addressee_id),
    GREATEST(requester_id, addressee_id)
  );

CREATE INDEX idx_friendships_addressee_pending
  ON friendships(addressee_id) WHERE status = 'pending';
