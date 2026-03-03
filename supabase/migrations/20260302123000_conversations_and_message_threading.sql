CREATE TABLE IF NOT EXISTS conversations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id UUID REFERENCES cases(id) NOT NULL,
  subject TEXT NOT NULL,
  child_id UUID REFERENCES children(id),
  created_by UUID REFERENCES users(id) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_conversations_case_id ON conversations(case_id);
CREATE INDEX IF NOT EXISTS idx_conversations_updated_at ON conversations(updated_at);

ALTER TABLE messages
ADD COLUMN IF NOT EXISTS conversation_id UUID REFERENCES conversations(id);

ALTER TABLE messages
ADD COLUMN IF NOT EXISTS ai_rewritten BOOLEAN NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS idx_messages_conversation_id ON messages(conversation_id);

ALTER TABLE conversations ENABLE ROW LEVEL SECURITY;

CREATE POLICY conversations_case_members_select ON conversations
  FOR SELECT
  USING (
    case_id IN (
      SELECT case_id FROM case_members WHERE user_id = auth.uid()
    )
  );

CREATE POLICY conversations_case_members_insert ON conversations
  FOR INSERT
  WITH CHECK (
    case_id IN (
      SELECT case_id FROM case_members WHERE user_id = auth.uid()
    )
  );

