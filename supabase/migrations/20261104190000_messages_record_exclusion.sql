-- Exclude a message from court-facing exports without deleting the audit row.
-- Null means the message is included. A non-empty value excludes it and is disclosed.
-- This does not allow deletes. The immutability trigger stays in place.

ALTER TABLE public.messages
  ADD COLUMN IF NOT EXISTS record_exclusion_reason TEXT;

COMMENT ON COLUMN public.messages.record_exclusion_reason IS
  'When non-empty, the communication record omits this message and prints this reason. Null means included.';

NOTIFY pgrst, 'reload schema';
