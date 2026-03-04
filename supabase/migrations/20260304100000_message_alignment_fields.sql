-- Add per-message vow alignment analysis fields.

ALTER TABLE messages
  ADD COLUMN IF NOT EXISTS vow_alignment_score NUMERIC,
  ADD COLUMN IF NOT EXISTS aligned_bool BOOLEAN,
  ADD COLUMN IF NOT EXISTS analysis_tags JSONB;

