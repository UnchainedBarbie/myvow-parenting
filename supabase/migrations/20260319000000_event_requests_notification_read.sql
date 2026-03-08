ALTER TABLE event_requests ADD COLUMN IF NOT EXISTS notification_read boolean DEFAULT false;

COMMENT ON COLUMN event_requests.notification_read IS 'When true, the kid has seen this approved/declined notification in the in-app notification panel.';
