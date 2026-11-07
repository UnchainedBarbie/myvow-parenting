/**
 * Who can see a calendar event on a parent surface.
 * Private is the creating parent only.
 * Just me and kids is the creating parent only here; the kids' calendar
 * shows that value to the children and still hides private events.
 * A blank visibility stays visible, except a legacy description that starts
 * with [PRIVATE], which is the creating parent only.
 */
export function eventVisibleOnCalendar(
  event: {
    visibility?: string | null;
    description?: string | null;
    created_by?: string | null;
  },
  viewerId: string
): boolean {
  const visibility = event.visibility ?? null;
  const legacyPrivate = !visibility && (event.description ?? "").startsWith("[PRIVATE]");
  if (visibility === "private" || visibility === "just_me_and_kids" || legacyPrivate) {
    return event.created_by === viewerId;
  }
  return true;
}
