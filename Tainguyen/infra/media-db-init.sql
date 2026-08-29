-- Schema Media DB - dung theo muc 7.2 cua
-- Congviec/he-thong-tong-hop-kien-truc-csdl-api-roadmap.md (chi Phan A -
-- Media DB. Phan B - MiniApp DB THUOC Phase 6, chua tao o day theo dung
-- ranh gioi Phase 5/Phase 6 cua roadmap muc 2).

CREATE TABLE meetings (
  id                BIGSERIAL PRIMARY KEY,
  host_id           BIGINT NOT NULL,
  workspace_id      BIGINT,
  conversation_id   BIGINT,
  status            VARCHAR(10) NOT NULL DEFAULT 'active'
                      CHECK (status IN ('active','ended')),
  max_participants  INT NOT NULL DEFAULT 100,
  -- Phong hop TUY CHINH: khong mo tu nhom nao, chi vao duoc bang link, va
  -- toan bo du lieu trong do (hoi thoai tam + tep) bi xoa khi hop ket thuc.
  -- Cuoc hop mo tu nhom chat thi = false: thao luan cua no thuoc ve nhom va
  -- duoc giu lai.
  is_temporary      BOOLEAN NOT NULL DEFAULT false,
  -- Co bat phong cho hay khong. Truoc day dieu nay bi suy ra cung nhac tu
  -- kieu loi moi (link thi luon phai duyet), nen host khong the doi y. Gio la
  -- mot cong tac host bat/tat ngay trong phong.
  --
  -- Mac dinh cua phong tuy chinh la FALSE - muc tieu la chu tri duoc mot cuoc
  -- hop trong ba cu bam, ma ngoi canh phong cho thi khong con la ba cu bam.
  requires_approval BOOLEAN NOT NULL DEFAULT true,

  -- MAC DINH CUA CA PHONG cho bon quyen duoi day ("Cai dat phong" trong ban
  -- thiet ke, Figma 140:645). Truoc day quyen chi co theo TUNG NGUOI trong
  -- meeting_permissions, nen chu phong khong dat duoc luat chung: tat mic cua
  -- nam nguoi dang ngoi thi nguoi thu sau vao van bat duoc.
  --
  -- Cach doc: mac dinh phong noi "duoc hay khong", rieng tung nguoi thi mot
  -- hang no_* trong meeting_permissions de bep len tren. Chu phong luon duoc
  -- phep, khong thi bam nham mot cai la tu khoa mieng minh khong mo lai duoc.
  allow_camera        BOOLEAN NOT NULL DEFAULT true,
  allow_mic           BOOLEAN NOT NULL DEFAULT true,
  allow_screen_share  BOOLEAN NOT NULL DEFAULT true,
  -- Rieng cai nay mac dinh TAT: mo mot ung dung la chieu len man hinh cua ca
  -- phong, khong phai thu ai vao cung lam duoc.
  allow_mini_app      BOOLEAN NOT NULL DEFAULT false,

  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  ended_at          TIMESTAMPTZ
);

CREATE INDEX idx_meetings_workspace ON meetings(workspace_id);
CREATE INDEX idx_meetings_status ON meetings(status);

CREATE TABLE meeting_participants (
  id           BIGSERIAL PRIMARY KEY,
  meeting_id   BIGINT NOT NULL REFERENCES meetings(id) ON DELETE CASCADE,
  user_id      BIGINT NOT NULL,
  -- VARCHAR(20), KHONG phai VARCHAR(10) nhu ban thiet ke goc muc 7.2 - 'participant'
  -- dai 11 ky tu, khong vua VARCHAR(10) (loi thuc te phat hien khi test Phase 5).
  role         VARCHAR(20) NOT NULL DEFAULT 'participant'
                 CHECK (role IN ('host','participant')),
  joined_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  left_at      TIMESTAMPTZ
);

CREATE INDEX idx_participants_in_room
  ON meeting_participants(meeting_id) WHERE left_at IS NULL;

CREATE TABLE meeting_invites (
  id                BIGSERIAL PRIMARY KEY,
  meeting_id        BIGINT NOT NULL REFERENCES meetings(id) ON DELETE CASCADE,
  invite_token      VARCHAR(100) NOT NULL UNIQUE,
  invite_type       VARCHAR(10) NOT NULL DEFAULT 'link'
                      CHECK (invite_type IN ('link','direct')),
  created_by        BIGINT NOT NULL,
  invited_user_id   BIGINT,
  expires_at        TIMESTAMPTZ,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE meeting_permissions (
  id                BIGSERIAL PRIMARY KEY,
  meeting_id        BIGINT NOT NULL REFERENCES meetings(id) ON DELETE CASCADE,
  user_id           BIGINT NOT NULL,
  -- share_screen / mini_app / focus_mode:     CO hang = DUOC phep.
  -- no_mic / no_camera / no_screen_share:     CO hang = BI CAM.
  -- Nguoc nghia nhau la co y: mic va camera thi mac dinh ai cung co, nen
  -- thao tac dang ghi lai la viec THU quyen. Xem Models/MeetingPermission.cs.
  --
  -- no_screen_share them sau, khi "Cai dat phong" ra doi: gio chia se man
  -- hinh cung mac dinh CO (meetings.allow_screen_share), nen cam mot nguoi
  -- moi la thao tac dang ghi - giong het mic va camera. Ba hang share_screen
  -- cu van doc duoc, chi khong con ai ghi them.
  permission_type   VARCHAR(20) NOT NULL
                      CHECK (permission_type IN ('share_screen','mini_app','focus_mode','no_mic','no_camera','no_screen_share')),
  granted_by        BIGINT NOT NULL,
  granted_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (meeting_id, user_id, permission_type)
);

-- Trigger: tu dong dong phong khi nguoi cuoi cung roi (UC-36)
CREATE OR REPLACE FUNCTION close_meeting_if_empty()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.left_at IS NOT NULL AND OLD.left_at IS NULL THEN
    IF NOT EXISTS (
      SELECT 1 FROM meeting_participants
      WHERE meeting_id = NEW.meeting_id AND left_at IS NULL
    ) THEN
      UPDATE meetings
        SET status = 'ended', ended_at = now()
        WHERE id = NEW.meeting_id AND status = 'active';
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_close_meeting_if_empty
  AFTER UPDATE OF left_at ON meeting_participants
  FOR EACH ROW EXECUTE FUNCTION close_meeting_if_empty();
