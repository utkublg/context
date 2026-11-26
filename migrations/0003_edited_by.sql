-- Who last changed a memory (an assistant, or 'You' from the web UI). source keeps meaning
-- where the fact was learned, so editing or merging no longer relabels its origin.
ALTER TABLE memories ADD COLUMN edited_by TEXT;
