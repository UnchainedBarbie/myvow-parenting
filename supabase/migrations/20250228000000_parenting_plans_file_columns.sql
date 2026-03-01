-- Add file_path and file_name to parenting_plans for court order uploads (Profile flow).
ALTER TABLE parenting_plans ADD COLUMN IF NOT EXISTS file_path TEXT;
ALTER TABLE parenting_plans ADD COLUMN IF NOT EXISTS file_name TEXT;
COMMENT ON COLUMN parenting_plans.file_path IS 'Storage path in inbox bucket for the uploaded court order file';
COMMENT ON COLUMN parenting_plans.file_name IS 'Original filename for display and download';
