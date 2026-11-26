-- Forward link from a retired memory to the one that replaced it. supersedes_id points
-- back to a single row, which can't record a merge of several memories into one.
ALTER TABLE memories ADD COLUMN superseded_by TEXT REFERENCES memories(id);
