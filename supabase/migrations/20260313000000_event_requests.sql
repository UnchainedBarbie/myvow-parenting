CREATE TABLE IF NOT EXISTS event_requests (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  case_id uuid NOT NULL,
  requested_by_child_id uuid,
  requested_date date NOT NULL,
  requested_time time,
  title text NOT NULL,
  notes text,
  status text DEFAULT 'pending',
  approved_event_id uuid,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  deleted_at timestamptz
);

COMMENT ON TABLE event_requests IS 'Kids request events; parent can approve (creates calendar_event) or decline';
