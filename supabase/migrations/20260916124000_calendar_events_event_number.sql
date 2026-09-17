-- Per-case sequential event_number. Column may already exist as SERIAL on live DBs.

ALTER TABLE calendar_events
  ADD COLUMN IF NOT EXISTS event_number INTEGER;

ALTER TABLE calendar_events
  ALTER COLUMN event_number DROP DEFAULT;

WITH numbered AS (
  SELECT
    e.id,
    COALESCE(m.max_n, 0) + ROW_NUMBER() OVER (
      PARTITION BY e.case_id
      ORDER BY e.created_at ASC, e.id ASC
    ) AS n
  FROM calendar_events e
  LEFT JOIN (
    SELECT case_id, MAX(event_number) AS max_n
    FROM calendar_events
    GROUP BY case_id
  ) m ON m.case_id = e.case_id
  WHERE e.event_number IS NULL
)
UPDATE calendar_events e
SET event_number = numbered.n
FROM numbered
WHERE e.id = numbered.id
  AND e.event_number IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS calendar_events_case_number_idx
  ON calendar_events (case_id, event_number);

CREATE OR REPLACE FUNCTION assign_event_number()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.event_number IS NULL THEN
    SELECT COALESCE(MAX(event_number), 0) + 1
    INTO NEW.event_number
    FROM calendar_events
    WHERE case_id = NEW.case_id;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS assign_event_number ON calendar_events;
CREATE TRIGGER assign_event_number
  BEFORE INSERT ON calendar_events
  FOR EACH ROW
  EXECUTE FUNCTION assign_event_number();
