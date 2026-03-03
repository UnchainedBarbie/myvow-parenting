-- Private per-user message flags (bookmarks)

CREATE TABLE IF NOT EXISTS message_user_flags (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    message_id UUID NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    flag_type TEXT NOT NULL DEFAULT 'bookmark',
    note TEXT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT message_user_flags_unique UNIQUE (message_id, user_id, flag_type)
);

ALTER TABLE message_user_flags ENABLE ROW LEVEL SECURITY;

-- Flags are private to the user
CREATE POLICY "message_user_flags_owner"
ON message_user_flags
FOR ALL
USING (user_id = auth.uid())
WITH CHECK (user_id = auth.uid());

CREATE INDEX IF NOT EXISTS idx_message_user_flags_user_created_at
ON message_user_flags(user_id, created_at);

CREATE INDEX IF NOT EXISTS idx_message_user_flags_message_id
ON message_user_flags(message_id);

