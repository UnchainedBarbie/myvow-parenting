-- App mode: solo, partner, coparenting. Behavioral settings for messaging.
ALTER TABLE cases ADD COLUMN IF NOT EXISTS app_mode TEXT DEFAULT 'partner' CHECK (app_mode IN ('solo', 'partner', 'coparenting'));
ALTER TABLE cases ADD COLUMN IF NOT EXISTS ai_moderation_level TEXT DEFAULT 'standard' CHECK (ai_moderation_level IN ('off', 'standard', 'high'));
COMMENT ON COLUMN cases.app_mode IS 'App mode: solo (just you), partner (cooperative co-parent), coparenting (AI-moderated communication)';
COMMENT ON COLUMN cases.ai_moderation_level IS 'AI moderation level for messages; used when app_mode is coparenting';
