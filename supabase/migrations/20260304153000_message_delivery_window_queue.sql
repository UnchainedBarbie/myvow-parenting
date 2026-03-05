-- Message delivery window queue + notification suppression

ALTER TABLE messages
ADD COLUMN IF NOT EXISTS deliver_at TIMESTAMPTZ;

ALTER TABLE messages
ADD COLUMN IF NOT EXISTS notification_suppressed BOOLEAN NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS idx_messages_deliver_at
  ON messages(deliver_at)
  WHERE delivered_at IS NULL;

