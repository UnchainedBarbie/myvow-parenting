-- Labels for kids calendar: who is "user" and "coparent" (e.g. "Mom", "Dad")
ALTER TABLE cases ADD COLUMN IF NOT EXISTS kids_label_user TEXT;
ALTER TABLE cases ADD COLUMN IF NOT EXISTS kids_label_coparent TEXT;
COMMENT ON COLUMN cases.kids_label_user IS 'Label for primary parent on kids calendar (e.g. Mom, Dad)';
COMMENT ON COLUMN cases.kids_label_coparent IS 'Label for co-parent on kids calendar (e.g. Mom, Dad)';
