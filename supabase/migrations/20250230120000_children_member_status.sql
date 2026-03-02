-- Child member status: not_invited (show Invite), invited (Pending), active (Active e.g. accepted or minor/no account).
ALTER TABLE children ADD COLUMN IF NOT EXISTS member_status TEXT DEFAULT 'not_invited'
  CHECK (member_status IN ('not_invited', 'invited', 'active'));

ALTER TABLE children ADD COLUMN IF NOT EXISTS invited_email TEXT;
ALTER TABLE children ADD COLUMN IF NOT EXISTS invited_phone TEXT;

COMMENT ON COLUMN children.member_status IS 'not_invited: show Invite; invited: invite sent, pending; active: connected or minor (no account needed).';
COMMENT ON COLUMN children.invited_email IS 'Email used when inviting this child to the app (when member_status = invited).';
COMMENT ON COLUMN children.invited_phone IS 'Phone used when inviting (optional).';

-- Existing children: treat as not_invited so no one defaults to Active.
UPDATE children SET member_status = 'not_invited' WHERE member_status IS NULL;
