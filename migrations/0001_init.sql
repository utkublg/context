-- One row per person. Identity comes from Google sign-in.
CREATE TABLE users (
  id         TEXT PRIMARY KEY,             -- our own id (uuid)
  google_sub TEXT NOT NULL UNIQUE,         -- Google's stable account id; emails can change
  email      TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

-- Memories are never hard-deleted: edits create a new row that supersedes the old
-- one, and "forget" flips status. This keeps the history needed to study how often
-- memories go stale or contradict each other.
CREATE TABLE memories (
  id            TEXT PRIMARY KEY,
  user_id       TEXT NOT NULL REFERENCES users(id),
  content       TEXT NOT NULL,
  category      TEXT NOT NULL CHECK (category IN
                  ('about_me', 'preferences', 'projects', 'people', 'goals', 'decisions', 'current')),
  source        TEXT NOT NULL,              -- 'ChatGPT', 'Claude', 'import', 'manual', ...
  explicit      INTEGER NOT NULL DEFAULT 0, -- 1 = the user said it, 0 = an AI inferred it
  confidence    REAL NOT NULL DEFAULT 0.7,
  status        TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'superseded', 'forgotten')),
  supersedes_id TEXT REFERENCES memories(id),
  created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX memories_user_status ON memories (user_id, status, category);
