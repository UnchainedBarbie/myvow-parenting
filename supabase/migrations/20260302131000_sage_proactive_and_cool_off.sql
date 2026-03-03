-- Messages: delivery + intensity + emergency metadata
ALTER TABLE messages
ADD COLUMN IF NOT EXISTS delivery_status TEXT NOT NULL DEFAULT 'delivered' CHECK (delivery_status IN ('pending','delivered','buffered','blocked'));

ALTER TABLE messages
ADD COLUMN IF NOT EXISTS delivered_at TIMESTAMPTZ;

ALTER TABLE messages
ADD COLUMN IF NOT EXISTS is_emergency BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE messages
ADD COLUMN IF NOT EXISTS emergency_type TEXT;

ALTER TABLE messages
ADD COLUMN IF NOT EXISTS emergency_note TEXT;

ALTER TABLE messages
ADD COLUMN IF NOT EXISTS intensity_score REAL;

ALTER TABLE messages
ADD COLUMN IF NOT EXISTS intensity_flag BOOLEAN NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS idx_messages_intensity ON messages (conversation_id, intensity_flag, created_at);

-- User-level messaging settings
CREATE TABLE IF NOT EXISTS user_settings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  proactive_sage_enabled BOOLEAN NOT NULL DEFAULT true,
  proactive_sage_incoming_enabled BOOLEAN NOT NULL DEFAULT true,
  proactive_sage_drafts_enabled BOOLEAN NOT NULL DEFAULT true,
  structured_pause_enabled BOOLEAN NOT NULL DEFAULT true,
  cool_off_enabled BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_user_settings_user_id ON user_settings(user_id);

ALTER TABLE user_settings ENABLE ROW LEVEL SECURITY;

CREATE POLICY user_settings_self ON user_settings
  FOR ALL
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

-- Conversation-specific overrides (per user)
CREATE TABLE IF NOT EXISTS conversation_settings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id UUID REFERENCES conversations(id) ON DELETE CASCADE,
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  proactive_sage_enabled BOOLEAN,
  structured_pause_enabled BOOLEAN,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (conversation_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_conversation_settings_conv_user
  ON conversation_settings(conversation_id, user_id);

ALTER TABLE conversation_settings ENABLE ROW LEVEL SECURITY;

CREATE POLICY conversation_settings_self ON conversation_settings
  FOR ALL
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

-- Structured pauses per conversation
CREATE TABLE IF NOT EXISTS structured_pauses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id UUID REFERENCES conversations(id) ON DELETE CASCADE,
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  mode TEXT NOT NULL CHECK (mode IN ('user_unilateral','user_mutual','auto')),
  starts_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  ends_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_structured_pauses_conv ON structured_pauses(conversation_id, ends_at);

ALTER TABLE structured_pauses ENABLE ROW LEVEL SECURITY;

CREATE POLICY structured_pauses_case_members ON structured_pauses
  FOR ALL
  USING (
    conversation_id IN (
      SELECT id FROM conversations
      WHERE case_id IN (
        SELECT case_id FROM case_members WHERE user_id = auth.uid()
      )
    )
  )
  WITH CHECK (
    conversation_id IN (
      SELECT id FROM conversations
      WHERE case_id IN (
        SELECT case_id FROM case_members WHERE user_id = auth.uid()
      )
    )
  );

-- Edit history for proactive settings (NOT cool-off)
CREATE TABLE IF NOT EXISTS edit_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  scope TEXT NOT NULL CHECK (scope IN ('global','conversation')),
  conversation_id UUID REFERENCES conversations(id),
  field TEXT NOT NULL,
  old_value JSONB,
  new_value JSONB,
  changed_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_edit_history_user ON edit_history(user_id, changed_at DESC);

ALTER TABLE edit_history ENABLE ROW LEVEL SECURITY;

CREATE POLICY edit_history_self ON edit_history
  FOR ALL
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

-- Global cool-off per user (PRIVATE)
CREATE TABLE IF NOT EXISTS cool_off (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  starts_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  ends_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  cancelled_at TIMESTAMPTZ,
  is_active BOOLEAN NOT NULL DEFAULT true
);

CREATE INDEX IF NOT EXISTS idx_cool_off_user_active
  ON cool_off(user_id, is_active, ends_at);

ALTER TABLE cool_off ENABLE ROW LEVEL SECURITY;

CREATE POLICY cool_off_self ON cool_off
  FOR ALL
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

