-- Capture live unique index on sage_items (source_type, source_id) where source_id
-- is present — already applied in the database; IF NOT EXISTS keeps this re-run-safe.
-- Link inbox_items to the sage_items row produced by processInboxItem.

CREATE UNIQUE INDEX IF NOT EXISTS sage_items_source_idx
  ON sage_items (source_type, source_id)
  WHERE source_id IS NOT NULL;

ALTER TABLE inbox_items
  ADD COLUMN IF NOT EXISTS sage_item_id UUID REFERENCES sage_items(id);
