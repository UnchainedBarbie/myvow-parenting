ALTER TABLE event_requests ADD COLUMN IF NOT EXISTS requested_parent text DEFAULT 'either';

COMMENT ON COLUMN event_requests.requested_parent IS 'Which parent the request is for: user (case primary), coparent, or either (show to both).';
