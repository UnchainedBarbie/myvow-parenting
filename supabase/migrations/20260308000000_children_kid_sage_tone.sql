-- Sage tone for Kids Access: younger / default / older
ALTER TABLE children ADD COLUMN IF NOT EXISTS kid_sage_tone TEXT DEFAULT 'default' CHECK (kid_sage_tone IN ('younger', 'default', 'older'));
COMMENT ON COLUMN children.kid_sage_tone IS 'Sage tone for this child in Kids app: younger, default, older';
