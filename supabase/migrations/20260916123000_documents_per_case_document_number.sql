-- Convert document_number from global SERIAL default to per-case sequence.

ALTER TABLE documents
  ALTER COLUMN document_number DROP DEFAULT;

WITH numbered AS (
  SELECT
    d.id,
    COALESCE(m.max_n, 0) + ROW_NUMBER() OVER (
      PARTITION BY d.case_id
      ORDER BY d.created_at ASC, d.id ASC
    ) AS n
  FROM documents d
  LEFT JOIN (
    SELECT case_id, MAX(document_number) AS max_n
    FROM documents
    GROUP BY case_id
  ) m ON m.case_id = d.case_id
  WHERE d.document_number IS NULL
)
UPDATE documents d
SET document_number = numbered.n
FROM numbered
WHERE d.id = numbered.id
  AND d.document_number IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS documents_case_number_idx
  ON documents (case_id, document_number);

CREATE OR REPLACE FUNCTION assign_document_number()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.document_number IS NULL THEN
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
  BEFORE INSERT ON documents
  FOR EACH ROW
  EXECUTE FUNCTION assign_document_number();
