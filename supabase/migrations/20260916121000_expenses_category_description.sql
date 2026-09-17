-- Free-text note when expense category is "other".

ALTER TABLE expenses
  ADD COLUMN IF NOT EXISTS category_description TEXT;
