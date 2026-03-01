-- Audit trail for parenting_plans (court orders) metadata edits.
CREATE TABLE IF NOT EXISTS court_order_history (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    parenting_plan_id UUID NOT NULL REFERENCES parenting_plans(id) ON DELETE CASCADE,
    changed_by UUID NOT NULL REFERENCES users(id),
    field_changed TEXT NOT NULL,
    old_value TEXT,
    new_value TEXT,
    created_at TIMESTAMPTZ DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_court_order_history_plan_id ON court_order_history(parenting_plan_id);
CREATE INDEX IF NOT EXISTS idx_court_order_history_created_at ON court_order_history(parenting_plan_id, created_at);

COMMENT ON TABLE court_order_history IS 'Append-only audit log of court order (parenting_plans) metadata edits.';
