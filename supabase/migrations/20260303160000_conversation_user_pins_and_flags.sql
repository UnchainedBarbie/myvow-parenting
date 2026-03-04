-- Per-user pins: pinned conversations stick to top of list (private to user)
CREATE TABLE IF NOT EXISTS conversation_user_pins (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  conversation_id UUID NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(user_id, conversation_id)
);

CREATE INDEX IF NOT EXISTS idx_conversation_user_pins_user_id ON conversation_user_pins(user_id);
CREATE INDEX IF NOT EXISTS idx_conversation_user_pins_conversation_id ON conversation_user_pins(conversation_id);

ALTER TABLE conversation_user_pins ENABLE ROW LEVEL SECURITY;

CREATE POLICY conversation_user_pins_owner ON conversation_user_pins
  FOR ALL
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

-- Per-user conversation flags: private flag on whole conversation (not visible to co-parent)
CREATE TABLE IF NOT EXISTS conversation_user_flags (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  conversation_id UUID NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(user_id, conversation_id)
);

CREATE INDEX IF NOT EXISTS idx_conversation_user_flags_user_id ON conversation_user_flags(user_id);
CREATE INDEX IF NOT EXISTS idx_conversation_user_flags_conversation_id ON conversation_user_flags(conversation_id);

ALTER TABLE conversation_user_flags ENABLE ROW LEVEL SECURITY;

CREATE POLICY conversation_user_flags_owner ON conversation_user_flags
  FOR ALL
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());
