-- Ledger date for when the expense was incurred (distinct from created_at).

ALTER TABLE expenses
  ADD COLUMN IF NOT EXISTS incurred_date DATE;
