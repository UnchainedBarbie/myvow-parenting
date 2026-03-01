-- Soft delete for children: hide from UI without breaking references.
ALTER TABLE children ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;

COMMENT ON COLUMN children.deleted_at IS 'When set, child is soft-deleted and excluded from profile lists.';
