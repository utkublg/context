-- Pro features: personal API keys, semantic search, automatic cleanup and Google Drive backups.

-- Personal API keys, for scripts and MCP clients that take a header instead of OAuth (Claude
-- Code, Cursor, ...). Only a SHA-256 hash of each key is stored; the key itself is shown once.
CREATE TABLE api_keys (
  id           TEXT PRIMARY KEY,
  user_id      TEXT NOT NULL,
  name         TEXT NOT NULL,              -- the user's label, also the "Saved by" name of its writes
  key_hash     TEXT NOT NULL UNIQUE,       -- hex SHA-256 of the full key
  prefix       TEXT NOT NULL,              -- first characters of the key, so the user can tell keys apart
  created_at   TEXT NOT NULL,
  last_used_at TEXT                        -- updated at most hourly
);
CREATE INDEX api_keys_user ON api_keys (user_id);

-- Semantic search: which embedding model a memory's vector (in Vectorize, keyed by memory id)
-- was made with. Null = not embedded yet; search embeds missing ones on demand.
ALTER TABLE memories ADD COLUMN embedded_with TEXT;

-- Automatic cleanup: suggestions found by the weekly pass, for the user to apply or dismiss.
-- merge: duplicates, or a contradiction resolved into the newer fact. forget: outdated.
CREATE TABLE cleanup_suggestions (
  id          TEXT PRIMARY KEY,
  user_id     TEXT NOT NULL,
  kind        TEXT NOT NULL CHECK (kind IN ('merge', 'forget')),
  memory_ids  TEXT NOT NULL,               -- JSON array of the memory ids it's about
  content     TEXT,                        -- the merged sentence; null for forget
  reason      TEXT NOT NULL,
  status      TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'applied', 'dismissed')),
  created_at  TEXT NOT NULL,
  resolved_at TEXT
);
CREATE INDEX cleanup_user_status ON cleanup_suggestions (user_id, status);

ALTER TABLE users ADD COLUMN cleanup_at TEXT;                         -- last cleanup pass
ALTER TABLE users ADD COLUMN cleanup_auto INTEGER NOT NULL DEFAULT 0;  -- 1 = apply merges of duplicates without asking

-- Google Drive backups. The refresh token is encrypted with TOKEN_ENCRYPTION_KEY.
CREATE TABLE backups (
  user_id        TEXT PRIMARY KEY,
  provider       TEXT NOT NULL DEFAULT 'google_drive',
  account_email  TEXT,                     -- the Google account the files go to
  refresh_token  TEXT NOT NULL,            -- AES-GCM ciphertext, base64
  folder_id      TEXT,                     -- the "Context Backups" folder, created on first backup
  frequency      TEXT NOT NULL DEFAULT 'daily' CHECK (frequency IN ('daily', 'weekly')),
  last_backup_at TEXT,
  last_attempt_at TEXT,                    -- a failed backup is retried 6 hours later, not every hour
  last_error     TEXT,                     -- shown on the Account page; cleared by the next success
  needs_reconnect INTEGER NOT NULL DEFAULT 0, -- 1 = Google access was revoked; paused until reconnected
  created_at     TEXT NOT NULL
) WITHOUT ROWID;

-- Memories deleted from D1 while they still had a vector. The daily cron deletes these vectors
-- from Vectorize, so an embedding never outlives the memory it came from.
CREATE TABLE vector_tombstones (id TEXT PRIMARY KEY) WITHOUT ROWID;
