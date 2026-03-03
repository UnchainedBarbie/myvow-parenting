-- Sage and privacy controls on user_settings
ALTER TABLE user_settings
ADD COLUMN IF NOT EXISTS sage_message_review BOOLEAN NOT NULL DEFAULT true;

ALTER TABLE user_settings
ADD COLUMN IF NOT EXISTS vow_references BOOLEAN NOT NULL DEFAULT true;

ALTER TABLE user_settings
ADD COLUMN IF NOT EXISTS default_pause_duration TEXT NOT NULL DEFAULT '2hours'
  CHECK (default_pause_duration IN ('30min','2hours','until_tomorrow'));

ALTER TABLE user_settings
ADD COLUMN IF NOT EXISTS send_read_receipts BOOLEAN NOT NULL DEFAULT false;
