-- Documents vault: visibility, new categories, AI/access fields, related log.
-- Safe to run; adds only if missing.

-- Extend document_category with communication, incident
DO $$ BEGIN ALTER TYPE document_category ADD VALUE 'communication'; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER TYPE document_category ADD VALUE 'incident'; EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Document visibility enum
DO $$
BEGIN
  CREATE TYPE document_visibility AS ENUM ('private', 'shared', 'shared_ai_review');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- New columns on documents
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'documents' AND column_name = 'visibility') THEN
    ALTER TABLE documents ADD COLUMN visibility document_visibility DEFAULT 'private';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'documents' AND column_name = 'related_comm_id') THEN
    ALTER TABLE documents ADD COLUMN related_comm_id TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'documents' AND column_name = 'ai_processed') THEN
    ALTER TABLE documents ADD COLUMN ai_processed BOOLEAN DEFAULT false;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'documents' AND column_name = 'access_log') THEN
    ALTER TABLE documents ADD COLUMN access_log JSONB DEFAULT '[]';
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_documents_visibility ON documents(visibility);
CREATE INDEX IF NOT EXISTS idx_documents_related_comm ON documents(related_comm_id) WHERE related_comm_id IS NOT NULL;
