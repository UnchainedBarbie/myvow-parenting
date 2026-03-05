-- Sage sessions: session_type for private vs incident modes.

ALTER TABLE sage_sessions
  ADD COLUMN IF NOT EXISTS session_type TEXT DEFAULT 'private';

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'sage_sessions_session_type_check') THEN
    ALTER TABLE sage_sessions DROP CONSTRAINT sage_sessions_session_type_check;
  END IF;

  ALTER TABLE sage_sessions
    ADD CONSTRAINT sage_sessions_session_type_check
    CHECK (session_type IN ('private', 'incident'));
END $$;

CREATE INDEX IF NOT EXISTS idx_sage_sessions_user_type_updated
  ON sage_sessions(user_id, session_type, updated_at DESC);

NOTIFY pgrst, 'reload schema';

