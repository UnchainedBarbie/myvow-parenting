ALTER TABLE event_requests ADD COLUMN IF NOT EXISTS photo_url text;

COMMENT ON COLUMN event_requests.photo_url IS 'Optional photo URL (e.g. flyer) uploaded with the request.';
