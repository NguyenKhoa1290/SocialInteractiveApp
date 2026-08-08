-- Schema MiniApp DB - dung theo muc 7.2 (Phan B - MiniApp DB) cua
-- Congviec/he-thong-tong-hop-kien-truc-csdl-api-roadmap.md. Vi du minh hoa:
-- Mini App 1 - App xem IPTV (UC-37). CSDL rieng voi Media DB ("database per
-- service" - ve nguyen tac Mini App co the la 1 service/nhom bang rieng
-- khac voi phan Meetings cot loi, dung chung 1 API surface trong giai doan
-- nay theo dung cach OpenAPI spec muc 7.3 gop chung).

CREATE TABLE iptv_channel_lists (
  id           BIGSERIAL PRIMARY KEY,
  user_id      BIGINT NOT NULL,
  name         VARCHAR(100) NOT NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_channel_lists_user ON iptv_channel_lists(user_id);

CREATE TABLE iptv_channel_groups (
  id           BIGSERIAL PRIMARY KEY,
  list_id      BIGINT NOT NULL REFERENCES iptv_channel_lists(id) ON DELETE CASCADE,
  group_name   VARCHAR(100) NOT NULL
);

CREATE TABLE iptv_channels (
  id             BIGSERIAL PRIMARY KEY,
  group_id       BIGINT NOT NULL REFERENCES iptv_channel_groups(id) ON DELETE CASCADE,
  channel_name   VARCHAR(100) NOT NULL,
  stream_url     VARCHAR(500) NOT NULL,
  audio_track    VARCHAR(100)
);
