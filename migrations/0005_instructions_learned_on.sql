-- Adds the 'instructions' category (rules the user wants assistants to follow) and
-- learned_on (when a fact was originally learned, e.g. from an import's dates).
-- SQLite can't alter a CHECK constraint, so the table is rebuilt. D1 enforces foreign
-- keys and ignores PRAGMA foreign_keys=OFF, so checks are deferred to commit. The old
-- table is renamed away first: building memories_new and dropping the original instead
-- would count every self-reference as orphaned and fail the commit on non-empty data.
PRAGMA defer_foreign_keys = true;

ALTER TABLE memories RENAME TO memories_old;

CREATE TABLE memories (
  id            TEXT PRIMARY KEY,
  user_id       TEXT NOT NULL REFERENCES users(id),
  content       TEXT NOT NULL,
  category      TEXT NOT NULL CHECK (category IN
                  ('instructions', 'about_me', 'preferences', 'projects', 'people', 'goals', 'decisions', 'current')),
  source        TEXT NOT NULL,
  explicit      INTEGER NOT NULL DEFAULT 0,
  confidence    REAL NOT NULL DEFAULT 0.7,
  status        TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'superseded', 'forgotten')),
  supersedes_id TEXT REFERENCES memories(id),
  created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  superseded_by TEXT REFERENCES memories(id),
  edited_by     TEXT,
  learned_on    TEXT                        -- YYYY-MM-DD; null when unknown
);

INSERT INTO memories (id, user_id, content, category, source, explicit, confidence, status,
                      supersedes_id, created_at, updated_at, superseded_by, edited_by)
SELECT id, user_id, content, category, source, explicit, confidence, status,
       supersedes_id, created_at, updated_at, superseded_by, edited_by
FROM memories_old;

DROP TABLE memories_old;

CREATE INDEX memories_user_status ON memories (user_id, status, category);
