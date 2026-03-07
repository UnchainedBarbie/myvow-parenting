-- Soft delete for holiday_custody: exclude from GET when deleted_at is set.
ALTER TABLE holiday_custody ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;

COMMENT ON COLUMN holiday_custody.deleted_at IS 'When set, row is soft-deleted and excluded from list.';
