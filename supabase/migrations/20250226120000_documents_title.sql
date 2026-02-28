-- Documents: add human-readable title (primary label in list)
ALTER TABLE documents ADD COLUMN IF NOT EXISTS title TEXT NOT NULL DEFAULT '';

-- Backfill: use filename without extension for existing rows
UPDATE documents SET title = regexp_replace(file_name, '\.[^.]*$', '') WHERE title = '' AND file_name IS NOT NULL AND file_name != '';

COMMENT ON COLUMN documents.title IS 'Human-readable document title; required for new uploads.';
