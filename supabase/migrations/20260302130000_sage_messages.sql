CREATE TABLE IF NOT EXISTS sage_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id UUID REFERENCES conversations(id) NOT NULL,
  user_id UUID REFERENCES users(id) NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('user','sage')),
  content TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_sage_messages_conv_user
  ON sage_messages(conversation_id, user_id, created_at);

ALTER TABLE sage_messages ENABLE ROW LEVEL SECURITY;

CREATE POLICY sage_messages_own_conversation ON sage_messages
  FOR ALL
  USING (
    user_id = auth.uid()
    AND conversation_id IN (
      SELECT id FROM conversations
      WHERE case_id IN (
        SELECT case_id FROM case_members WHERE user_id = auth.uid()
      )
    )
  )
  WITH CHECK (
    user_id = auth.uid()
    AND conversation_id IN (
      SELECT id FROM conversations
      WHERE case_id IN (
        SELECT case_id FROM case_members WHERE user_id = auth.uid()
      )
    )
  );

