-- date_incurred was a dead column. Copy any remaining values onto incurred_date, then drop it.

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'expenses'
      AND column_name = 'date_incurred'
  ) THEN
    UPDATE expenses
    SET incurred_date = date_incurred
    WHERE date_incurred IS NOT NULL
      AND incurred_date IS NULL;

    ALTER TABLE expenses DROP COLUMN date_incurred;
  END IF;
END $$;
