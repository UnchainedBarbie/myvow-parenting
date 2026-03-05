-- Sage journal sessions: each session groups messages for the split-panel UI.

CREATE TABLE IF NOT EXISTS sage_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title TEXT,
  category TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_sage_sessions_user_updated
  ON sage_sessions(user_id, updated_at DESC);

ALTER TABLE sage_sessions ENABLE ROW LEVEL SECURITY;

CREATE POLICY sage_sessions_owner ON sage_sessions
  FOR ALL
  USING (user_id = auth.uid());

-- Link journal messages to a session (nullable for backward compatibility).
ALTER TABLE sage_journal_messages
  ADD COLUMN IF NOT EXISTS session_id UUID REFERENCES sage_sessions(id) ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS idx_sage_journal_messages_session
  ON sage_journal_messages(session_id, created_at ASC);

NOTIFY pgrst, 'reload schema';
