-- $0 co-parent share is a personal/documentation record, not awaiting a co-parent response.
UPDATE expenses
SET status = 'resolved'
WHERE deleted_at IS NULL
  AND status = 'submitted'
  AND COALESCE(other_parent_share, amount_owed, 0) <= 0;
