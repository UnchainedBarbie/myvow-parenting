import { createClient, getServiceRoleClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { AddEventForm } from "@/components/calendar/add-event-form";
import type { CalendarEventRow } from "@/components/calendar/calendar-month";
import { CalendarRoot } from "@/components/calendar/calendar-root";
import { CalendarInboxButton } from "@/components/calendar/calendar-inbox-button";

function getMonthRange(year: number, month: number) {
  const start = new Date(year, month - 1, 1);
  const end = new Date(year, month, 0, 23, 59, 59, 999);
  return {
    start: start.toISOString(),
    end: end.toISOString(),
  };
}

export default async function CalendarPage({
  searchParams,
}: {
  searchParams: { year?: string; month?: string };
}) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const now = new Date();
  const year = searchParams.year ? parseInt(searchParams.year, 10) : now.getFullYear();
  const month = searchParams.month ? parseInt(searchParams.month, 10) : now.getMonth() + 1;
  const safeYear = Number.isNaN(year) ? now.getFullYear() : year;
  const safeMonth = Math.min(12, Math.max(1, Number.isNaN(month) ? now.getMonth() + 1 : month));

  const admin = getServiceRoleClient();
  const { data: membership } = await admin
    .from("case_members")
    .select("case_id")
    .eq("user_id", user.id)
    .limit(1)
    .maybeSingle();

  const caseId = membership?.case_id ?? null;

  if (!caseId) {
    return (
      <div className="p-6 md:p-8">
        <h1 className="font-heading text-2xl font-semibold text-foreground mb-2">
          Calendar
        </h1>
        <p className="text-foreground-secondary mb-8">
          Shared record of parenting events.
        </p>
        <div className="rounded-card border border-border bg-background-secondary p-8 text-center">
          <p className="text-foreground-secondary">
            Create or join a case in Settings to view and add events.
          </p>
        </div>
      </div>
    );
  }

  const { data: children } = await admin
    .from("children")
    .select("id, first_name, profile_image")
    .eq("case_id", caseId)
    .order("first_name");

  const { start, end } = getMonthRange(safeYear, safeMonth);
  const { data: eventsRaw } = await admin
    .from("calendar_events")
    .select(
      "id, title, description, event_type, child_id, start_time, end_time, all_day, status, visibility, kid_title, created_by, created_at, recurring_rule, deleted_at"
    )
    .eq("case_id", caseId)
    .gte("start_time", start)
    .lte("start_time", end)
    .is("deleted_at", null)
    .order("start_time", { ascending: true });

  const childIds = [
    ...new Set(
      (eventsRaw ?? []).map((e) => e.child_id).filter(Boolean)
    ),
  ] as string[];
  const { data: childRows } =
    childIds.length > 0
      ? await admin.from("children").select("id, first_name, profile_image").in("id", childIds)
      : { data: [] };
  const childMap = (childRows ?? []).reduce(
    (acc, c) => {
      acc[c.id] = {
        first_name: c.first_name as string,
        profile_image: (c.profile_image as string | null) ?? null,
      };
      return acc;
    },
    {} as Record<string, { first_name: string; profile_image: string | null }>
  );

  const creatorIds = [
    ...new Set(
      (eventsRaw ?? []).map((e) => e.created_by).filter(Boolean)
    ),
  ] as string[];
  const { data: creatorRows } =
    creatorIds.length > 0
      ? await admin.from("users").select("id, full_name").in("id", creatorIds)
      : { data: [] };
  const creatorMap = (creatorRows ?? []).reduce(
    (acc, u) => {
      acc[u.id] = u.full_name;
      return acc;
    },
    {} as Record<string, string>
  );

  // Debug: log raw events from Supabase, including status/deleted_at
  // eslint-disable-next-line no-console
  console.log("[CalendarPage] eventsRaw", eventsRaw);

  const events: CalendarEventRow[] = (eventsRaw ?? [])
    .filter((e) => {
      // Respect explicit visibility when present; fall back to legacy [PRIVATE] marker.
      const visibility = (e as any).visibility as
        | "family"
        | "parents_only"
        | "private"
        | "family_read_only"
        | null
        | undefined;
      const legacyPrivate = e.description?.startsWith("[PRIVATE]") ?? false;

      if (visibility === "private") {
        return e.created_by === user.id;
      }
      if (!visibility && legacyPrivate) {
        return e.created_by === user.id;
      }
      return true;
    })
    .map((e) => {
      const visibility = (e as any).visibility as
        | "family"
        | "parents_only"
        | "private"
        | "family_read_only"
        | null
        | undefined;
      const legacyPrivate = e.description?.startsWith("[PRIVATE]") ?? false;
      const isPrivate =
        visibility === "private" || (!visibility && legacyPrivate);
      const desc =
        !visibility && legacyPrivate
          ? e.description?.replace(/^\[PRIVATE\]\s*/, "") ?? null
          : e.description;
      return {
        id: e.id,
        title: e.title,
        description: desc,
        event_type: e.event_type,
        child_id: e.child_id,
        child_name: e.child_id ? childMap[e.child_id]?.first_name ?? null : null,
        start_time: e.start_time,
        end_time: e.end_time,
        all_day: e.all_day ?? false,
        status: (e as any).status ?? null,
        isPrivate,
        isMine: e.created_by === user.id,
        created_at: e.created_at,
        created_by_name: creatorMap[e.created_by] ?? null,
        recurring_rule: e.recurring_rule ?? null,
        visibility: visibility ?? null,
        kid_title: (e as any).kid_title ?? null,
      };
    });

  const nowIso = new Date().toISOString();
  const { data: upcomingRaw } = await admin
    .from("calendar_events")
    .select(
      "id, title, description, event_type, child_id, start_time, end_time, all_day, status, visibility, kid_title, created_by, created_at, recurring_rule, deleted_at"
    )
    .eq("case_id", caseId)
    .gte("start_time", nowIso)
    .is("deleted_at", null)
    .order("start_time", { ascending: true })
    .limit(10);

  const upcoming = (upcomingRaw ?? []).map((e) => ({
    id: e.id,
    title: e.title,
    event_type: e.event_type as string | null,
    child_name: e.child_id ? childMap[e.child_id]?.first_name ?? null : null,
    start_time: e.start_time as string,
    status: (e as any).status as string | null,
  }));

  const eventIdsInMonth = new Set(events.map((e) => e.id));
  const toEventRow = (e: (typeof eventsRaw)[number]) => {
    const visibility = (e as any).visibility as
      | "family"
      | "parents_only"
      | "private"
      | "family_read_only"
      | null
      | undefined;
    const legacyPrivate = e.description?.startsWith("[PRIVATE]") ?? false;
    const isPrivate =
      visibility === "private" || (!visibility && legacyPrivate);
    const desc =
      !visibility && legacyPrivate
        ? e.description?.replace(/^\[PRIVATE\]\s*/, "") ?? null
        : e.description;
    return {
      id: e.id,
      title: e.title,
      description: desc,
      event_type: e.event_type,
      child_id: e.child_id,
    child_name: e.child_id ? childMap[e.child_id]?.first_name ?? null : null,
      start_time: e.start_time,
      end_time: e.end_time,
      all_day: e.all_day ?? false,
      status: (e as any).status ?? null,
      isPrivate,
      isMine: e.created_by === user.id,
      created_at: e.created_at,
      created_by_name: creatorMap[e.created_by] ?? null,
      recurring_rule: e.recurring_rule ?? null,
      visibility: visibility ?? null,
      kid_title: (e as any).kid_title ?? null,
    };
  };
  const upcomingFullRows: CalendarEventRow[] = (upcomingRaw ?? [])
    .filter((e) => {
      const visibility = (e as any).visibility as
        | "family"
        | "parents_only"
        | "private"
        | "family_read_only"
        | null
        | undefined;
      const legacyPrivate = e.description?.startsWith("[PRIVATE]") ?? false;
      if (visibility === "private") return e.created_by === user.id;
      if (!visibility && legacyPrivate) return e.created_by === user.id;
      return true;
    })
    .map((e) => toEventRow(e));
  const eventsForModal: CalendarEventRow[] = [
    ...events,
    ...upcomingFullRows.filter((e) => !eventIdsInMonth.has(e.id)),
  ];

  return (
    <div className="px-3 pt-3 pb-1 md:px-4 md:pt-4 md:pb-2">
      <div className="flex items-center justify-between gap-2 mb-1">
        <h1 className="font-heading text-xl md:text-2xl font-semibold text-foreground">
          Calendar
        </h1>
        <CalendarInboxButton />
      </div>
      <p className="text-xs md:text-sm text-foreground-secondary mb-2">
        Shared record of parenting events.
      </p>
      <div className="space-y-2.5">
        <div className="grid gap-3 lg:grid-cols-[460px_minmax(0,1fr)] items-start">
          <AddEventForm
            caseId={caseId}
            children={children ?? []}
            initialYear={safeYear}
            initialMonth={safeMonth}
          />
          <CalendarRoot
            caseId={caseId}
            events={events}
            upcoming={upcoming}
            eventsForModal={eventsForModal}
            children={children ?? []}
          />
        </div>
      </div>
    </div>
  );
}
