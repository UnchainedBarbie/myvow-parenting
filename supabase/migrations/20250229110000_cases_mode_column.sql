-- cases.mode: solo, partner, coparenting, solo_coparenting
ALTER TABLE cases ADD COLUMN IF NOT EXISTS mode TEXT DEFAULT 'partner' CHECK (mode IN ('solo', 'partner', 'coparenting', 'solo_coparenting'));
COMMENT ON COLUMN cases.mode IS 'App mode: solo, partner, coparenting, solo_coparenting. When null/legacy, app_mode is used.';
