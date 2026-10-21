-- Store the recipient recorded when a message is sent or received.
-- Run this manually in Supabase. It does not backfill historical rows.
-- Existing messages stay without a recipient until a new send or ingest writes one.

ALTER TABLE public.messages
  ADD COLUMN IF NOT EXISTS recipient_email TEXT,
  ADD COLUMN IF NOT EXISTS recipient_cc TEXT;

COMMENT ON COLUMN public.messages.recipient_email IS
  'To address recorded at send or ingest. Not inferred from conversation membership.';

COMMENT ON COLUMN public.messages.recipient_cc IS
  'Cc addresses recorded from the mail service, excluding the case ingest mailbox.';

NOTIFY pgrst, 'reload schema';
