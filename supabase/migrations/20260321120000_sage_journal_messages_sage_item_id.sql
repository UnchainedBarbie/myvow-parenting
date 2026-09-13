-- Link a Sage journal turn to the sage_items row that holds its proposals.
ALTER TABLE sage_journal_messages
  ADD COLUMN IF NOT EXISTS sage_item_id UUID REFERENCES sage_items(id);

CREATE INDEX IF NOT EXISTS idx_sage_journal_messages_sage_item
  ON sage_journal_messages(sage_item_id);

NOTIFY pgrst, 'reload schema';
