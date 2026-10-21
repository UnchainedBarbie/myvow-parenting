-- Link an outgoing message to the Sage proposal that was actually sent.
-- This does not backfill old messages. A reply is matched only when this id is set.
-- Unlinked messages stay unrelated, even in the same conversation.

ALTER TABLE public.messages
  ADD COLUMN IF NOT EXISTS sage_proposal_id TEXT;

COMMENT ON COLUMN public.messages.sage_proposal_id IS
  'sage_items.plan.proposals id this outgoing message sent. Not inferred from conversation or wording.';

CREATE INDEX IF NOT EXISTS messages_sage_proposal_idx
  ON public.messages (case_id, sage_proposal_id)
  WHERE sage_proposal_id IS NOT NULL;

NOTIFY pgrst, 'reload schema';
