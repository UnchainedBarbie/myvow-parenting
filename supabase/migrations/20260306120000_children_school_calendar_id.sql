-- Link a child to a school calendar (for break/holiday assignment).
ALTER TABLE children ADD COLUMN IF NOT EXISTS school_calendar_id UUID;
COMMENT ON COLUMN children.school_calendar_id IS 'Optional link to school_calendars.id for this child.';
