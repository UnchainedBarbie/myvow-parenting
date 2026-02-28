-- Calendar Inbox: email + photo capture for events
-- Run after base schema. Safe to run if columns already exist (manual add).

-- Inbox messages (email or photo)
CREATE TABLE IF NOT EXISTS calendar_inbox_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id) NOT NULL,
  case_id UUID REFERENCES cases(id) NOT NULL,
  source TEXT NOT NULL DEFAULT 'email',  -- 'email' | 'photo'
  from_email TEXT,
  to_email TEXT,
  subject TEXT,
  body_text TEXT,
  body_html TEXT,
  received_at TIMESTAMPTZ DEFAULT now() NOT NULL,
  raw_payload_json JSONB,
  parse_status TEXT NOT NULL DEFAULT 'pending',  -- 'pending'|'parsed'|'needs_review'|'failed'
  parse_error TEXT,
  parsed_title TEXT,
  parsed_date DATE,
  parsed_start_time TIMESTAMPTZ,
  parsed_end_time TIMESTAMPTZ,
  parsed_location TEXT,
  parsed_notes TEXT,
  parsed_category TEXT,
  parsed_child_id UUID REFERENCES children(id),
  parsed_visibility TEXT DEFAULT 'family',
  parse_confidence DECIMAL(3,2),  -- 0.00 to 1.00
  created_event_id UUID REFERENCES calendar_events(id),
  created_at TIMESTAMPTZ DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_inbox_user_id ON calendar_inbox_messages(user_id);
CREATE INDEX IF NOT EXISTS idx_inbox_case_id ON calendar_inbox_messages(case_id);
CREATE INDEX IF NOT EXISTS idx_inbox_parse_status ON calendar_inbox_messages(parse_status);

-- Attachments: link event to original email/photo for audit
CREATE TABLE IF NOT EXISTS calendar_event_attachments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id UUID REFERENCES calendar_events(id) ON DELETE CASCADE NOT NULL,
  attachment_type TEXT NOT NULL,  -- 'email' | 'photo'
  inbox_message_id UUID REFERENCES calendar_inbox_messages(id),
  storage_path TEXT,   -- for photo
  content_text TEXT,   -- for email body snippet
  created_at TIMESTAMPTZ DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_event_attachments_event_id ON calendar_event_attachments(event_id);

-- Add provenance to calendar_events (ignore if already present)
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'calendar_events' AND column_name = 'source') THEN
    ALTER TABLE calendar_events ADD COLUMN source TEXT DEFAULT 'manual';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'calendar_events' AND column_name = 'source_message_id') THEN
    ALTER TABLE calendar_events ADD COLUMN source_message_id UUID REFERENCES calendar_inbox_messages(id);
  END IF;
END $$;

-- Inbox address per user (for email routing)
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'users' AND column_name = 'calendar_inbox_email') THEN
    ALTER TABLE users ADD COLUMN calendar_inbox_email TEXT UNIQUE;
  END IF;
END $$;
