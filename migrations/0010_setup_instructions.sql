-- When the user said they pasted Context's note into this app's custom instructions (step 1 and
-- step 4 of the setup checklist). Apps connected before the checklist asked for it count as done,
-- so existing users aren't asked again.
ALTER TABLE user_apps ADD COLUMN instructions_at TEXT;
UPDATE user_apps SET instructions_at = connected_at;
