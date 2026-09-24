-- Capture documents.status (pending | active | dismissed) and assign
-- document_number only when a row becomes active — pending rows must not
-- consume an identifier.

ALTER TABLE documents
  ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'active';

DO $$
BEGIN
  ALTER TABLE documents
    ADD CONSTRAINT documents_status_check
    CHECK (status IN ('pending', 'active', 'dismissed'));
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

CREATE OR REPLACE FUNCTION assign_document_number()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.status = 'active' AND NEW.document_number IS NULL THEN
    SELECT COALESCE(MAX(document_number), 0) + 1
    INTO NEW.document_number
    FROM documents
    WHERE case_id = NEW.case_id;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS assign_document_number ON documents;
CREATE TRIGGER assign_document_number
  BEFORE INSERT OR UPDATE ON documents
  FOR EACH ROW
  EXECUTE FUNCTION assign_document_number();
