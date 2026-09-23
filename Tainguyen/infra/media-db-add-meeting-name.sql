-- Chay MOT LAN tren Media DB da ton tai truoc khi deploy Media Service co
-- tinh nang dat ten cuoc hop. An toan khi chay lai.
ALTER TABLE meetings
  ADD COLUMN IF NOT EXISTS name VARCHAR(120);
