ALTER TABLE event_requests ADD COLUMN IF NOT EXISTS visibility text DEFAULT 'just_me_and_kids';

COMMENT ON COLUMN event_requests.visibility IS 'When approved, the created calendar_event uses this visibility (just_me_and_kids: visible to approving parent + kids, not co-parent).';
