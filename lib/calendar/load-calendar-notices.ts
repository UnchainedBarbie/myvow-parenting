import type { getServiceRoleClient } from "@/lib/supabase/server";
import { calendarNoticeLink, readCalendarEventRef } from "@/lib/calendar/coparent-notice";

type Admin = ReturnType<typeof getServiceRoleClient>;

export type CalendarNoticeCard = {
  id: string;
  title: string;
  text: string;
  href: string | null;
};

export async function loadCalendarNoticeCards(
  admin: Admin,
  userId: string,
  timezone: string
): Promise<CalendarNoticeCard[]> {
  const { data } = await admin
    .from("parent_notifications")
    .select("id, title, message")
    .eq("user_id", userId)
    .eq("type", "calendar_event")
    .eq("read", false)
    .order("created_at", { ascending: false })
    .limit(8);
  const notices = (data ?? []) as Array<{ id: string; title?: string | null; message?: string | null }>;
  const eventIds = Array.from(
    new Set(
      notices
        .map((notice) => readCalendarEventRef(notice.message ?? "").eventId)
        .filter((id): id is string => Boolean(id))
    )
  );
  const { data: eventRows } = eventIds.length
    ? await admin
        .from("calendar_events")
        .select("id, case_id, visibility, created_by, description, start_time, deleted_at")
        .in("id", eventIds)
    : { data: [] };
  const caseIds = Array.from(
    new Set(
      (eventRows ?? [])
        .map((row) => (row as { case_id?: string | null }).case_id)
        .filter((id): id is string => Boolean(id))
    )
  );
  const { data: memberships } = caseIds.length
    ? await admin.from("case_members").select("case_id").eq("user_id", userId).in("case_id", caseIds)
    : { data: [] };
  const memberCaseIds = (memberships ?? [])
    .map((row) => (row as { case_id?: string | null }).case_id)
    .filter((id): id is string => Boolean(id));
  const eventsById = new Map(
    (eventRows ?? []).map((row) => {
      const event = row as {
        id: string;
        case_id?: string | null;
        visibility?: string | null;
        created_by?: string | null;
        description?: string | null;
        start_time?: string | null;
        deleted_at?: string | null;
      };
      return [event.id, event] as const;
    })
  );
  return notices.map((notice) => {
    const stored = eventsById.get(readCalendarEventRef(notice.message ?? "").eventId ?? "");
    const linked = calendarNoticeLink({
      message: notice.message ?? "",
      viewerId: userId,
      memberCaseIds,
      timezone,
      event: stored
        ? {
            id: stored.id,
            caseId: stored.case_id ?? "",
            visibility: stored.visibility ?? null,
            createdBy: stored.created_by ?? null,
            description: stored.description ?? null,
            start: stored.start_time ?? null,
            deleted: Boolean(stored.deleted_at),
          }
        : null,
    });
    return {
      id: notice.id,
      title: notice.title?.trim() || "Calendar event",
      text: linked.text,
      href: linked.href,
    };
  });
}
