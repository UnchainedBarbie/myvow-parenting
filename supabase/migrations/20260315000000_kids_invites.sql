-- Kids email invites: table and columns for PIN/email access.
CREATE TABLE IF NOT EXISTS kids_invites (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  case_id uuid NOT NULL,
  child_member_id uuid NOT NULL,
  email text NOT NULL,
  token text NOT NULL UNIQUE,
  status text DEFAULT 'pending',
  created_at timestamptz DEFAULT now(),
  expires_at timestamptz DEFAULT now() + interval '7 days',
  accepted_at timestamptz
);

ALTER TABLE case_members ADD COLUMN IF NOT EXISTS kids_email text;
ALTER TABLE case_members ADD COLUMN IF NOT EXISTS kids_invite_status text DEFAULT 'none';
ALTER TABLE case_members ADD COLUMN IF NOT EXISTS kids_pin_hash text;
ALTER TABLE case_members ADD COLUMN IF NOT EXISTS child_id uuid REFERENCES children(id);

-- Allow one invited coparent (user_id null, child_id null) per case; allow multiple kid rows (child_id set).
DROP INDEX IF EXISTS case_members_one_invited_per_case;
CREATE UNIQUE INDEX IF NOT EXISTS case_members_one_invited_coparent_per_case
  ON case_members (case_id) WHERE user_id IS NULL AND child_id IS NULL;

COMMENT ON TABLE kids_invites IS 'Email invite for a child to access kids calendar; token in link.';
COMMENT ON COLUMN case_members.kids_email IS 'Child login email when invited by email.';
COMMENT ON COLUMN case_members.kids_invite_status IS 'none | pending | accepted.';
COMMENT ON COLUMN case_members.kids_pin_hash IS 'Hashed PIN for email-based kid login.';
COMMENT ON COLUMN case_members.child_id IS 'Links case_member row to children.id for email-invited kids.';
