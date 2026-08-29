-- Schema MiniApp DB - dung theo muc 7.2 (Phan B - MiniApp DB) cua
-- Congviec/he-thong-tong-hop-kien-truc-csdl-api-roadmap.md. Vi du minh hoa:
-- Mini App 1 - App xem IPTV (UC-37). CSDL rieng voi Media DB ("database per
-- service" - ve nguyen tac Mini App co the la 1 service/nhom bang rieng
-- khac voi phan Meetings cot loi, dung chung 1 API surface trong giai doan
-- nay theo dung cach OpenAPI spec muc 7.3 gop chung).

CREATE TABLE iptv_channel_lists (
  id           BIGSERIAL PRIMARY KEY,
  -- Nguoi tao. Voi playlist dung chung thi day la admin da dat no len.
  user_id      BIGINT NOT NULL,
  name         VARCHAR(100) NOT NULL,
  -- Playlist DUNG CHUNG do admin dat san: MOI nguoi deu thay va xem duoc,
  -- nhung chi admin sua/xoa duoc. Nguoi dung van tu them playlist rieng nhu
  -- cu - hai loai nam chung mot bang vi chung y het nhau ve cau truc, chi
  -- khac ai duoc doc va ai duoc sua.
  is_shared    BOOLEAN NOT NULL DEFAULT false,

  -- Link M3U da nhap playlist nay. Co gia tri = danh sach kenh duoc TU DONG
  -- nhap lai moi 10 phut (xem PlaylistRefreshService), vi nguon IPTV hay doi
  -- duong dan luong va them/bot kenh. NULL = playlist tu go tay, khong dong
  -- vao.
  source_url   TEXT,
  -- Nho lai lua chon "tu dong nhan dien playlist con" cua lan nhap dau, de
  -- lan lam moi sau khong xep kenh vao nhom khac han.
  auto_groups  BOOLEAN NOT NULL DEFAULT true,
  refreshed_at TIMESTAMPTZ,

  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_channel_lists_user ON iptv_channel_lists(user_id);
-- Ai mo Mini App cung phai liet ke playlist dung chung, nen truy van nay
-- chay nhieu hon han truy van theo user.
CREATE INDEX idx_channel_lists_shared ON iptv_channel_lists(is_shared) WHERE is_shared;

CREATE TABLE iptv_channel_groups (
  id           BIGSERIAL PRIMARY KEY,
  list_id      BIGINT NOT NULL REFERENCES iptv_channel_lists(id) ON DELETE CASCADE,
  group_name   VARCHAR(100) NOT NULL
);

CREATE TABLE iptv_channels (
  id             BIGSERIAL PRIMARY KEY,
  group_id       BIGINT NOT NULL REFERENCES iptv_channel_groups(id) ON DELETE CASCADE,
  channel_name   VARCHAR(100) NOT NULL,
  -- TEXT chu khong phai VARCHAR(500): link luong cua nhieu nha cung cap co
  -- token ky rat dai. Cat mot URL la hong han duong dan, con bo qua kenh do
  -- thi nguoi dung mat kenh ma khong hieu vi sao - ca hai deu te hon la cho
  -- cot dai tuy y.
  stream_url     TEXT NOT NULL,
  audio_track    VARCHAR(100)
);
