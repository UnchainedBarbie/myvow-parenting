-- Manual schedule: store a 14-day repeating pattern (user/coparent/neither per day)
-- instead of specific dates in custody_day_overrides.
ALTER TABLE custody_schedules
  ADD COLUMN IF NOT EXISTS manual_pattern jsonb;

COMMENT ON COLUMN custody_schedules.manual_pattern IS 'For schedule_type=manual: 14-element array of "user"|"coparent"|"neither", one per day starting from rotation_start_date (Sunday).';
