-- Run once on an existing Chat database before deploying the service that
-- verifies uploaded object sizes. Fresh installations already receive this
-- column from chat-db-init.sql.
ALTER TABLE files
    ADD COLUMN IF NOT EXISTS upload_verified_at TIMESTAMPTZ;
