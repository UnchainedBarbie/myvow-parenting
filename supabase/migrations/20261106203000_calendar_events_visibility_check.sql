-- Who can see a calendar event.
-- Matches the live check calendar_events_visibility_check:
-- family, parents_only, private, just_me_and_kids, family_read_only.
-- The column is already NOT NULL. This check does not change existing rows.

ALTER TABLE public.calendar_events
  DROP CONSTRAINT IF EXISTS calendar_events_visibility_check;

ALTER TABLE public.calendar_events
  ADD CONSTRAINT calendar_events_visibility_check
  CHECK (
    visibility IN (
      'family',
      'parents_only',
      'private',
      'just_me_and_kids',
      'family_read_only'
    )
  );
