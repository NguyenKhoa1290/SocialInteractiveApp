-- Schema SpamTracking DB - KHONG co trong tai lieu roadmap goc (muc 8 chi mo ta
-- API + luong su kien, khong co "Thiet ke CSDL" rieng) - tu thiet ke bang toi
-- thieu de luu ket qua phan tich, phuc vu GET /internal/violations (UC-11, UC-38).

CREATE TABLE violations (
  id              BIGSERIAL PRIMARY KEY,
  user_id         BIGINT NOT NULL,
  detected_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  reason          TEXT NOT NULL,
  account_status  VARCHAR(20) NOT NULL DEFAULT 'locked'
                    CHECK (account_status IN ('locked','deleted')),
  score           INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX idx_violations_user ON violations(user_id);
CREATE INDEX idx_violations_detected_at ON violations(detected_at);
