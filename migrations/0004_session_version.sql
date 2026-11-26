-- Lets logout invalidate a specific user's existing session cookies without
-- rotating SESSION_SECRET for everyone.
ALTER TABLE users ADD COLUMN session_version INTEGER NOT NULL DEFAULT 0;
