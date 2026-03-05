-- Parenting plan expense allocation rules

CREATE TYPE expense_allocation_rule_type AS ENUM ('SPLIT_PERCENT', 'FIXED_AMOUNT', 'NONE', 'MANUAL');

CREATE TABLE IF NOT EXISTS parenting_plan_expense_rules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  parenting_plan_id UUID REFERENCES parenting_plans(id) ON DELETE CASCADE,
  case_id UUID REFERENCES cases(id) ON DELETE CASCADE,
  category expense_category,
  child_scope UUID REFERENCES children(id),
  rule_type expense_allocation_rule_type NOT NULL DEFAULT 'SPLIT_PERCENT',
  payer_default TEXT, -- 'MOTHER' | 'FATHER' | 'EITHER' (informational)
  other_parent_percent DECIMAL(5,2),
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_parenting_plan_expense_rules_case
  ON parenting_plan_expense_rules(case_id, parenting_plan_id, category, child_scope);

ALTER TABLE expenses
  ADD COLUMN IF NOT EXISTS allocation_status TEXT, -- 'ALLOCATED' | 'NONE' | 'MANUAL_REQUIRED'
  ADD COLUMN IF NOT EXISTS other_parent_percent DECIMAL(5,2),
  ADD COLUMN IF NOT EXISTS other_parent_share DECIMAL(10,2),
  ADD COLUMN IF NOT EXISTS split_label TEXT;

