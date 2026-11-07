-- Shared expenses move through Pending, Approved, and Paid. Disputed branches off Pending.
-- A personal expense (their share $0.00) is Logged and has no workflow.
-- Nothing in this migration is marked Paid. Rows already Paid stay Paid.

ALTER TABLE expenses
  ADD COLUMN IF NOT EXISTS paid_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS paid_amount NUMERIC(10, 2),
  ADD COLUMN IF NOT EXISTS disputed_by UUID REFERENCES users(id),
  ADD COLUMN IF NOT EXISTS disputed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS payment_edited_by UUID REFERENCES users(id),
  ADD COLUMN IF NOT EXISTS payment_edited_at TIMESTAMPTZ;

COMMENT ON COLUMN expenses.paid_amount IS
  'Amount recorded when a payment is applied. A payment below their share leaves the remainder outstanding.';
COMMENT ON COLUMN expenses.payment_edited_by IS
  'Parent who last changed a recorded payment.';
COMMENT ON COLUMN expenses.payment_edited_at IS
  'When a recorded payment was last changed.';
COMMENT ON COLUMN expenses.disputed_by IS
  'Parent who disputed the expense.';
COMMENT ON COLUMN expenses.disputed_at IS
  'When the expense was disputed. dispute_reason holds the reason.';

-- status may be the expense_status enum, which has no logged value.
ALTER TABLE expenses
  ALTER COLUMN status TYPE text USING status::text;

DO $$
DECLARE
  constraint_name text;
BEGIN
  FOR constraint_name IN
    SELECT con.conname
    FROM pg_constraint con
    JOIN pg_class rel ON rel.oid = con.conrelid
    JOIN pg_namespace nsp ON nsp.oid = rel.relnamespace
    WHERE nsp.nspname = 'public'
      AND rel.relname = 'expenses'
      AND con.contype = 'c'
      AND pg_get_constraintdef(con.oid) ILIKE '%status%'
  LOOP
    EXECUTE format('ALTER TABLE expenses DROP CONSTRAINT %I', constraint_name);
  END LOOP;
END $$;

-- Their share matches the Expenses tab: a filled other_parent_share wins, including
-- an explicit zero that has a split label. A zero with no label and a positive
-- amount_owed is the older medical row, and amount_owed is the share.
UPDATE expenses
SET status = 'logged'
WHERE status IN ('resolved', 'submitted', 'logged')
  AND (
    CASE
      WHEN other_parent_share IS NOT NULL
        AND NOT (
          other_parent_share = 0
          AND btrim(COALESCE(split_label, '')) = ''
          AND COALESCE(amount_owed, 0) > 0
        )
      THEN other_parent_share
      ELSE amount_owed
    END
  ) IS NOT NULL
  AND (
    CASE
      WHEN other_parent_share IS NOT NULL
        AND NOT (
          other_parent_share = 0
          AND btrim(COALESCE(split_label, '')) = ''
          AND COALESCE(amount_owed, 0) > 0
        )
      THEN other_parent_share
      ELSE amount_owed
    END
  ) <= 0;

-- Remaining Resolved rows are agreed and unpaid. Do not mark them Paid.
UPDATE expenses
SET status = 'approved'
WHERE status = 'resolved';

-- Shared expenses still waiting on the co-parent use Pending.
-- A $0 share in submitted was already set to logged above.
UPDATE expenses
SET status = 'pending'
WHERE status = 'submitted';

ALTER TABLE expenses
  ADD CONSTRAINT expenses_status_check
  CHECK (
    status IS NULL
    OR status IN (
      'logged',
      'pending',
      'submitted',
      'approved',
      'resolved',
      'paid',
      'disputed'
    )
  );
