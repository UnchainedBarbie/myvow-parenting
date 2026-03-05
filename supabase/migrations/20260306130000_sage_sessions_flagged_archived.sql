-- Add flagged and archived to sage_sessions for left-panel actions and filters.

ALTER TABLE sage_sessions
  ADD COLUMN IF NOT EXISTS flagged boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS archived boolean NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS idx_sage_sessions_flagged
  ON sage_sessions(user_id, flagged) WHERE flagged = true;

CREATE INDEX IF NOT EXISTS idx_sage_sessions_archived
  ON sage_sessions(user_id, archived) WHERE archived = true;

NOTIFY pgrst, 'reload schema';
