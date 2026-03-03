-- Email-to-MyVow Inbox: user tokens, pending uploads, attachments; documents.source + inbound_upload_id
-- Run once.

-- User inbound email tokens: uploads+{token}@in.myvow.app -> user_id
CREATE TABLE IF NOT EXISTS user_inbound_tokens (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token TEXT NOT NULL UNIQUE,
  created_at TIMESTAMPTZ DEFAULT now() NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_user_inbound_tokens_token ON user_inbound_tokens(token);
CREATE INDEX IF NOT EXISTS idx_user_inbound_tokens_user_id ON user_inbound_tokens(user_id);

-- Inbound upload (one per email); status: pending_review | posted | discarded
CREATE TABLE IF NOT EXISTS inbound_uploads (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  case_id UUID NOT NULL REFERENCES cases(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'pending_review' CHECK (status IN ('pending_review', 'posted', 'discarded')),
  -- Email metadata
  from_email TEXT,
  subject TEXT,
  body_text TEXT,
  body_html TEXT,
  -- AI/heuristic suggestions (nullable; user edits before post)
  suggested_child_id UUID REFERENCES children(id) ON DELETE SET NULL,
  suggested_category TEXT,
  suggested_visibility TEXT,
  suggested_description TEXT,
  suggested_expense BOOLEAN DEFAULT false,
  suggested_amount DECIMAL(10,2),
  suggested_expense_date DATE,
  suggestion_confidence DECIMAL(3,2),
  created_at TIMESTAMPTZ DEFAULT now() NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_inbound_uploads_user_status ON inbound_uploads(user_id, status);
CREATE INDEX IF NOT EXISTS idx_inbound_uploads_case_created ON inbound_uploads(case_id, created_at DESC);

-- Attachments (files) per inbound email
CREATE TABLE IF NOT EXISTS inbound_upload_files (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  inbound_upload_id UUID NOT NULL REFERENCES inbound_uploads(id) ON DELETE CASCADE,
  file_name TEXT NOT NULL,
  mime_type TEXT,
  file_size_bytes BIGINT,
  storage_path TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now() NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_inbound_upload_files_upload ON inbound_upload_files(inbound_upload_id);

-- Documents: source (manual | email) and optional link to inbound upload
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'documents' AND column_name = 'source') THEN
    ALTER TABLE documents ADD COLUMN source TEXT NOT NULL DEFAULT 'manual' CHECK (source IN ('manual', 'email'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'documents' AND column_name = 'inbound_upload_id') THEN
    ALTER TABLE documents ADD COLUMN inbound_upload_id UUID REFERENCES inbound_uploads(id) ON DELETE SET NULL;
  END IF;
END $$;

-- RLS: user can only see their own inbound data
ALTER TABLE user_inbound_tokens ENABLE ROW LEVEL SECURITY;
ALTER TABLE inbound_uploads ENABLE ROW LEVEL SECURITY;
ALTER TABLE inbound_upload_files ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS user_inbound_tokens_select_own ON user_inbound_tokens;
CREATE POLICY user_inbound_tokens_select_own ON user_inbound_tokens
  FOR SELECT USING (auth.uid() = user_id);

DROP POLICY IF EXISTS inbound_uploads_select_own ON inbound_uploads;
CREATE POLICY inbound_uploads_select_own ON inbound_uploads
  FOR SELECT USING (auth.uid() = user_id);

DROP POLICY IF EXISTS inbound_uploads_update_own ON inbound_uploads;
CREATE POLICY inbound_uploads_update_own ON inbound_uploads
  FOR UPDATE USING (auth.uid() = user_id);

DROP POLICY IF EXISTS inbound_upload_files_select_via_upload ON inbound_upload_files;
CREATE POLICY inbound_upload_files_select_via_upload ON inbound_upload_files
  FOR SELECT USING (
    EXISTS (SELECT 1 FROM inbound_uploads u WHERE u.id = inbound_upload_id AND u.user_id = auth.uid())
  );

-- Service role / API will insert; no INSERT policy for end users on inbound_uploads/upload_files
-- Tokens: only user can read; creation can be via API with auth

COMMENT ON TABLE user_inbound_tokens IS 'Maps email token (uploads+token@in.myvow.app) to user for inbound email webhook';
COMMENT ON TABLE inbound_uploads IS 'Pending email uploads awaiting user review before posting to documents';
COMMENT ON TABLE inbound_upload_files IS 'Attachment files for each inbound_upload stored in Storage bucket inbound';
