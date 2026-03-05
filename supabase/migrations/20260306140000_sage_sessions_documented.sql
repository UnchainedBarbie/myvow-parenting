-- Track documented interactions on Sage sessions.

ALTER TABLE sage_sessions
  ADD COLUMN IF NOT EXISTS documented boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS documented_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_sage_sessions_documented
  ON sage_sessions(user_id, documented) WHERE documented = true;

NOTIFY pgrst, 'reload schema';

