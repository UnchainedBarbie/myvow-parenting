-- Documents: visibility (TEXT + check), soft delete, updated_at, document_number, index
-- Run once. If columns already exist, run the optional block below or add IF NOT EXISTS (PG 11+).

ALTER TABLE documents ADD COLUMN IF NOT EXISTS visibility TEXT NOT NULL DEFAULT 'family';
ALTER TABLE documents ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;
ALTER TABLE documents ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT now();
ALTER TABLE documents ADD COLUMN IF NOT EXISTS document_number SERIAL;

-- Constraint: drop first if re-running, then add
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'documents_visibility_check') THEN
    ALTER TABLE documents DROP CONSTRAINT documents_visibility_check;
  END IF;
  ALTER TABLE documents ADD CONSTRAINT documents_visibility_check
    CHECK (visibility IN ('family','parents_only','private','family_read_only'));
END $$;

CREATE INDEX IF NOT EXISTS documents_case_id_created_at_idx
  ON documents (case_id, created_at) WHERE deleted_at IS NULL;
