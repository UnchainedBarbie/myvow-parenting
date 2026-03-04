-- Private Sage journal messages per user.

CREATE TABLE IF NOT EXISTS sage_journal_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id) NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('user','sage')),
  content TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_sage_journal_messages_user
  ON sage_journal_messages(user_id, created_at DESC);

ALTER TABLE sage_journal_messages ENABLE ROW LEVEL SECURITY;

CREATE POLICY sage_journal_owner ON sage_journal_messages
  FOR ALL
  USING (user_id = auth.uid());

