-- Stores the current co-parent invitation on the existing case member.
-- The raw token is never stored. invitation_sent_at is set only after the email provider accepts the message.

ALTER TABLE public.case_members
  ADD COLUMN IF NOT EXISTS invitation_token_hash TEXT,
  ADD COLUMN IF NOT EXISTS invitation_expires_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS invitation_sent_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS invitation_last_error TEXT;

COMMENT ON COLUMN public.case_members.invitation_token_hash IS
  'SHA-256 of the current invitation token. The raw token exists only in the email link.';
COMMENT ON COLUMN public.case_members.invitation_expires_at IS
  'When the current invitation token stops working.';
COMMENT ON COLUMN public.case_members.invitation_sent_at IS
  'When the email provider last accepted an invitation for this member.';
COMMENT ON COLUMN public.case_members.invitation_last_error IS
  'Why the last invitation email was not accepted. Cleared after a successful send.';

NOTIFY pgrst, 'reload schema';
