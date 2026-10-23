-- Link a Sage journal turn to the incoming co-parent message that created it.
-- Safe to run more than once. Does not backfill older turns.

ALTER TABLE public.sage_journal_messages
  ADD COLUMN IF NOT EXISTS source_message_id UUID REFERENCES public.messages(id);

CREATE INDEX IF NOT EXISTS idx_sage_journal_messages_source_message
  ON public.sage_journal_messages(source_message_id);

COMMENT ON COLUMN public.sage_journal_messages.source_message_id IS
  'Incoming messages.id that created this Sage turn. Never inferred from subject or time.';

NOTIFY pgrst, 'reload schema';
