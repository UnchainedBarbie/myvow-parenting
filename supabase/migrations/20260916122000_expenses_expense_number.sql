-- Per-case sequential expense_number (EXP-NNN). Assigned on insert when null.

ALTER TABLE expenses
  ADD COLUMN IF NOT EXISTS expense_number INTEGER;

WITH numbered AS (
  SELECT
    e.id,
    COALESCE(m.max_n, 0) + ROW_NUMBER() OVER (
      PARTITION BY e.case_id
      ORDER BY e.created_at ASC, e.id ASC
    ) AS n
  FROM expenses e
  LEFT JOIN (
    SELECT case_id, MAX(expense_number) AS max_n
    FROM expenses
    GROUP BY case_id
  ) m ON m.case_id = e.case_id
  WHERE e.expense_number IS NULL
)
UPDATE expenses e
SET expense_number = numbered.n
FROM numbered
WHERE e.id = numbered.id
  AND e.expense_number IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS expenses_case_number_idx
  ON expenses (case_id, expense_number);

CREATE OR REPLACE FUNCTION assign_expense_number()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.expense_number IS NULL THEN
    SELECT COALESCE(MAX(expense_number), 0) + 1
    INTO NEW.expense_number
    FROM expenses
    WHERE case_id = NEW.case_id;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS assign_expense_number ON expenses;
CREATE TRIGGER assign_expense_number
  BEFORE INSERT ON expenses
  FOR EACH ROW
  EXECUTE FUNCTION assign_expense_number();
