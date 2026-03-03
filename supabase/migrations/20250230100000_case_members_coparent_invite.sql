-- Co-parent invite: store email, name, status on case_members for invited (not-yet-connected) co-parent.
-- user_id becomes nullable for invite rows; connected co-parents have user_id set.
ALTER TABLE case_members ALTER COLUMN user_id DROP NOT NULL;

ALTER TABLE case_members ADD COLUMN IF NOT EXISTS invited_email TEXT;
ALTER TABLE case_members ADD COLUMN IF NOT EXISTS invited_name TEXT;
ALTER TABLE case_members ADD COLUMN IF NOT EXISTS invitation_status TEXT DEFAULT 'connected'
  CHECK (invitation_status IN ('not_invited', 'invited', 'connected'));

COMMENT ON COLUMN case_members.invited_email IS 'Email for co-parent when invitation_status is invited (not yet connected).';
COMMENT ON COLUMN case_members.invited_name IS 'Display name for co-parent when invited or for display.';
COMMENT ON COLUMN case_members.invitation_status IS 'not_invited: placeholder; invited: invite sent; connected: user_id set and joined.';

-- Existing rows have user_id set; set invitation_status for them if null (backfill).
UPDATE case_members SET invitation_status = 'connected' WHERE user_id IS NOT NULL AND (invitation_status IS NULL OR invitation_status = 'not_invited');

-- At most one invited (placeholder) co-parent per case.
CREATE UNIQUE INDEX IF NOT EXISTS case_members_one_invited_per_case
  ON case_members (case_id) WHERE user_id IS NULL;
