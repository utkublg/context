-- Funnel tracking for the private /stats page: where each user came from, and how far they got
-- (signed up -> first AI app connected -> first memory saved by an AI -> second AI app).

-- A short label for where the user came from: "news.ycombinator.com", "producthunt", "invite",
-- "direct". Null for accounts from before tracking started.
ALTER TABLE users ADD COLUMN source TEXT;
-- When an AI app first saved a memory with remember. Imports can't be told apart from AI saves
-- by memories.source (the import form uses the same app names), so this is recorded directly.
ALTER TABLE users ADD COLUMN first_ai_save_at TEXT;
-- Set by `npm run grant-pro`, so the stats can tell hand-given Pro apart from invite rewards.
ALTER TABLE users ADD COLUMN pro_granted_at TEXT;

-- One row per AI app a user has connected. Grants live in OAUTH_KV, which can't be queried
-- across users, so connecting (the consent page) and using (any MCP tool call, at most hourly)
-- are recorded here. Deliberately not a foreign key, like users.referred_by.
CREATE TABLE user_apps (
  user_id      TEXT NOT NULL,
  app          TEXT NOT NULL,              -- sourceLabel(): 'ChatGPT', 'Claude', 'Gemini', 'Grok', ...
  connected_at TEXT NOT NULL,
  used_at      TEXT,                       -- last time it read or wrote memories; null until then
  PRIMARY KEY (user_id, app)
) WITHOUT ROWID;

-- Best-effort backfill from memories saved before tracking. A row with an app's name as its
-- source came from that app or from an import labelled with it; batches of more than 50 rows
-- at the same instant can only be imports (remember takes at most 50), so they're skipped.
-- An AI editing a memory (edited_by) is always a real connection.
WITH ai AS (
  SELECT m.user_id, m.source AS app, m.created_at AS at FROM memories m
  WHERE m.source IN ('ChatGPT', 'Claude', 'Gemini', 'Grok')
    AND (SELECT COUNT(*) FROM memories b WHERE b.user_id = m.user_id AND b.created_at = m.created_at) <= 50
  UNION ALL
  SELECT user_id, edited_by, updated_at FROM memories WHERE edited_by IN ('ChatGPT', 'Claude', 'Gemini', 'Grok')
)
INSERT OR IGNORE INTO user_apps (user_id, app, connected_at, used_at)
SELECT user_id, app, MIN(at), MAX(at) FROM ai WHERE user_id IN (SELECT id FROM users) GROUP BY user_id, app;

UPDATE users SET first_ai_save_at = (
  SELECT MIN(m.created_at) FROM memories m
  WHERE m.user_id = users.id AND m.source IN ('ChatGPT', 'Claude', 'Gemini', 'Grok')
    AND (SELECT COUNT(*) FROM memories b WHERE b.user_id = m.user_id AND b.created_at = m.created_at) <= 50
);
