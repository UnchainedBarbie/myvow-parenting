-- Groundwork only: future co-parent approval on calendar events.
-- Nothing reads or writes these columns yet (null = not in that flow).
ALTER TABLE calendar_events
  ADD COLUMN IF NOT EXISTS coparent_approval_status TEXT;

ALTER TABLE calendar_events
  ADD COLUMN IF NOT EXISTS coparent_rejection_reason TEXT;

NOTIFY pgrst, 'reload schema';
