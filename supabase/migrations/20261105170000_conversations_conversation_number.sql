-- Per-case conversation_number (CNV-NNN). Assigned on insert. Never backfilled.
-- Existing rows stay null. A partial unique index allows those nulls.
-- Once a number is stored, an update cannot change or clear it.

ALTER TABLE conversations
  ADD COLUMN IF NOT EXISTS conversation_number INTEGER;

CREATE UNIQUE INDEX IF NOT EXISTS conversations_case_number_idx
  ON conversations (case_id, conversation_number)
  WHERE conversation_number IS NOT NULL;

CREATE OR REPLACE FUNCTION assign_conversation_number()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.conversation_number IS NOT NULL THEN
    RAISE EXCEPTION 'conversation_number is assigned on insert and cannot be supplied';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtext('conversation_number:' || NEW.case_id::text));
  SELECT COALESCE(MAX(conversation_number), 0) + 1
    INTO NEW.conversation_number
    FROM conversations
    WHERE case_id = NEW.case_id
      AND conversation_number IS NOT NULL;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS assign_conversation_number ON conversations;
CREATE TRIGGER assign_conversation_number
  BEFORE INSERT ON conversations
  FOR EACH ROW
  EXECUTE FUNCTION assign_conversation_number();

CREATE OR REPLACE FUNCTION freeze_conversation_number()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF OLD.conversation_number IS NOT NULL
     AND NEW.conversation_number IS DISTINCT FROM OLD.conversation_number THEN
    RAISE EXCEPTION 'conversation_number cannot be changed once assigned';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS freeze_conversation_number ON conversations;
CREATE TRIGGER freeze_conversation_number
  BEFORE UPDATE ON conversations
  FOR EACH ROW
  EXECUTE FUNCTION freeze_conversation_number();
