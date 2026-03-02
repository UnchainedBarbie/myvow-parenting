-- Messaging window and quiet hours for Communication settings
ALTER TABLE cases ADD COLUMN IF NOT EXISTS messaging_window_start TIME;
ALTER TABLE cases ADD COLUMN IF NOT EXISTS messaging_window_end TIME;
ALTER TABLE cases ADD COLUMN IF NOT EXISTS quiet_hours_enabled BOOLEAN DEFAULT false;
COMMENT ON COLUMN cases.messaging_window_start IS 'Start of allowed messaging window (e.g. 08:00)';
COMMENT ON COLUMN cases.messaging_window_end IS 'End of allowed messaging window (e.g. 21:00)';
COMMENT ON COLUMN cases.quiet_hours_enabled IS 'When true, respect messaging window for delivery';
