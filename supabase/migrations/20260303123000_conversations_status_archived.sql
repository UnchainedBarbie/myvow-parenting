-- Conversations: add status with archived state
-- Safe to run if column already exists; only updates CHECK constraint.

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'conversations' AND column_name = 'status'
  ) THEN
    ALTER TABLE conversations
      ADD COLUMN status TEXT NOT NULL DEFAULT 'open';
  END IF;
END $$;

DO $$
BEGIN
  BEGIN
    ALTER TABLE conversations
      ADD CONSTRAINT conversations_status_check
      CHECK (status IN ('open','resolved','archived'));
  EXCEPTION WHEN duplicate_object THEN
    -- If constraint exists, replace it to include 'archived'
    ALTER TABLE conversations DROP CONSTRAINT conversations_status_check;
    ALTER TABLE conversations
      ADD CONSTRAINT conversations_status_check
      CHECK (status IN ('open','resolved','archived'));
  END;
END $$;

