-- Conversation topic tag for filtering and reports (Medical, School, Schedule, Expenses, General, Emergency)
ALTER TABLE conversations
ADD COLUMN IF NOT EXISTS topic TEXT;

-- Backfill from existing category where possible (map legacy values to tag set)
UPDATE conversations
SET topic = CASE
  WHEN category = 'expense' THEN 'expenses'
  WHEN category IN ('medical', 'school', 'schedule', 'expenses', 'general', 'emergency') THEN category
  WHEN category IN ('therapy', 'behavior') THEN 'general'
  WHEN category IS NOT NULL THEN 'general'
  ELSE NULL
END
WHERE topic IS NULL AND category IS NOT NULL;
