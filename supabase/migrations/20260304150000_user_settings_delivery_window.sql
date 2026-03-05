-- Delivery window settings for message notifications.

ALTER TABLE user_settings
  ADD COLUMN IF NOT EXISTS delivery_window_enabled BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE user_settings
  ADD COLUMN IF NOT EXISTS delivery_start_time TIME;

ALTER TABLE user_settings
  ADD COLUMN IF NOT EXISTS delivery_end_time TIME;

