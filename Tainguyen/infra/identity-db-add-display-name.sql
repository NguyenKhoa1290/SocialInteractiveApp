-- Chay MOT LAN tren Identity DB da ton tai truoc khi rollout Identity Service
-- co DisplayName. Khong xoa nguoi dung: ten cu thanh ten hien thi, con handle
-- duoc cap lai theo user id. Cach nay giu nguyen ID/quan he/chat cu va cung
-- dat toan bo tai khoan vao mo hinh handle do he thong tu sinh.
BEGIN;

ALTER TABLE users ADD COLUMN IF NOT EXISTS display_name VARCHAR(50);
UPDATE users
SET
  display_name = nickname,
  nickname = 'USER_' || lpad(id::text, 19, '0')
WHERE display_name IS NULL OR btrim(display_name) = '';
ALTER TABLE users ALTER COLUMN display_name SET NOT NULL;

COMMIT;
