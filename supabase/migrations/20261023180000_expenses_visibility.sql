-- Store who can see an expense.
--
-- NULL stays NULL. private, parents_only, and family stay as they are.
-- The only rewrite is the legacy alias 'parents' (any casing or surrounding
-- space) to 'parents_only'. That alias is not a valid check value, and it is
-- not the same as parents_only, private, or family.
-- Amount, split, share, and reimbursement columns are not updated.
-- Do not backfill NULL from a receipt or a split percentage.
--
-- Apply in the Supabase SQL editor. Confirm the column exists before
-- relying on new Private or Family saves.

ALTER TABLE public.expenses
  ADD COLUMN IF NOT EXISTS visibility text;

UPDATE public.expenses
SET visibility = 'parents_only'
WHERE lower(btrim(visibility)) = 'parents';

ALTER TABLE public.expenses
  DROP CONSTRAINT IF EXISTS expenses_visibility_check;

ALTER TABLE public.expenses
  ADD CONSTRAINT expenses_visibility_check
  CHECK (
    visibility IS NULL
    OR visibility IN ('private', 'parents_only', 'family')
  );

COMMENT ON COLUMN public.expenses.visibility IS
  'Who can access the expense: private, parents_only, or family. NULL means the value was never saved.';
