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
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_active_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT chk_guest_no_credentials
    CHECK (user_type <> 'guest' OR (email IS NULL AND password_hash IS NULL))
);

CREATE INDEX idx_users_email
  ON users(email) WHERE email IS NOT NULL;

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
