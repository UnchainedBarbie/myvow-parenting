import { createClient, getServiceRoleClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import Link from "next/link";
import { AddEventForm } from "@/components/calendar/add-event-form";
import type { CalendarEventRow } from "@/components/calendar/calendar-month";
import { CalendarWithCustody } from "@/components/calendar/calendar-with-custody";
import { CalendarExportButton } from "@/components/calendar/calendar-export-button";
import { CalendarYearView } from "@/components/calendar/calendar-year-view";
import { Card, CardContent, CardHeader } from "@/components/ui/card";

function getMonthRange(year: number, month: number) {
  const start = new Date(year, month - 1, 1);
  const end = new Date(year, month, 0, 23, 59, 59, 999);
  return {
    start: start.toISOString(),
    end: end.toISOString(),
  };
}

function getYearRange(year: number) {
  const start = new Date(year, 0, 1, 0, 0, 0, 0);
  const end = new Date(year, 11, 31, 23, 59, 59, 999);
  return {
    start: start.toISOString(),
    end: end.toISOString(),
  };
}

/** For list view: wide range so "Past 7/30/90", "Last month", "This month", and "Custom" have data. */
function getListRange() {
  const now = new Date();
  const start = new Date(now);
  start.setDate(start.getDate() - 90);
  start.setHours(0, 0, 0, 0);
  const end = new Date(now.getFullYear(), now.getMonth() + 2, 0, 23, 59, 59, 999);
  return {
    start: start.toISOString(),
    end: end.toISOString(),
  };
}

export default async function CalendarPage({
  searchParams,
}: {
  searchParams: { year?: string; month?: string; view?: string; from?: string; to?: string };
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

  const requestedView = (searchParams.view ?? "").toLowerCase();
  const view: "month" | "list" | "year" =
    requestedView === "year"
      ? "year"
      : requestedView === "list"
        ? "list"
        : "month";

  const admin = getServiceRoleClient();
  const { data: membership } = await admin
    .from("case_members")
    .select("case_id")
    .eq("user_id", user.id)
    .limit(1)
    .maybeSingle();

  const caseId = membership?.case_id ?? null;

  let custodySchedule: { schedule_type: string; rotation_start_date: string | null; user_starts_first: boolean | null } | null = null;
  let appMode: string | null = null;
  if (caseId) {
    const [scheduleRes, caseRes] = await Promise.all([
      admin.from("custody_schedules").select("schedule_type, rotation_start_date, user_starts_first").eq("case_id", caseId).limit(1).maybeSingle(),
      admin.from("cases").select("mode, app_mode").eq("id", caseId).single(),
    ]);
    const row = scheduleRes.data as { schedule_type?: string; rotation_start_date?: string | null; user_starts_first?: boolean | null } | null;
    if (row && (row.schedule_type === "week_on_week_off" || row.schedule_type === "five_two_two_five" || row.schedule_type === "two_two_three" || row.schedule_type === "manual")) {
      custodySchedule = {
        schedule_type: row.schedule_type,
        rotation_start_date: row.rotation_start_date ?? null,
        user_starts_first: row.user_starts_first ?? null,
      };
    }
    const caseRow = caseRes.data as { mode?: string | null; app_mode?: string | null } | null;
    appMode = caseRow?.mode ?? caseRow?.app_mode ?? null;
  }

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

  const { data: caseRow } = await admin
    .from("cases")
    .select("kids_label_user, kids_label_coparent")
    .eq("id", caseId)
    .single();
  const kidsLabelUser = (caseRow as { kids_label_user?: string | null } | null)?.kids_label_user ?? null;
  const kidsLabelCoparent = (caseRow as { kids_label_coparent?: string | null } | null)?.kids_label_coparent ?? null;

  const { data: holidaysRaw } = await admin
    .from("holiday_custody")
    .select("id, holiday_name, start_date, end_date, custodial_parent, year")
    .eq("case_id", caseId)
    .eq("year", safeYear)
    .is("deleted_at", null)
    .order("start_date", { ascending: true });
  const holidays = (holidaysRaw ?? []).map((h) => ({
    id: h.id as string,
    holiday_name: h.holiday_name as string,
    start_date: h.start_date as string,
    end_date: h.end_date as string,
    custodial_parent: h.custodial_parent as string,
    year: h.year as number,
  }));

  const { start, end } =
    view === "year"
      ? getYearRange(safeYear)
      : view === "list"
        ? getListRange()
        : getMonthRange(safeYear, safeMonth);
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

  const childIds = Array.from(
    new Set(
      (eventsRaw ?? []).map((e) => e.child_id).filter(Boolean)
    )
  ) as string[];
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

  const creatorIds = Array.from(
    new Set(
      (eventsRaw ?? []).map((e) => e.created_by).filter(Boolean)
    )
  ) as string[];
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
        | "just_me_and_kids"
        | "private"
        | "family_read_only"
        | null
        | undefined;
      const legacyPrivate = e.description?.startsWith("[PRIVATE]") ?? false;

      if (visibility === "private") {
        return e.created_by === user.id;
      }
      if (visibility === "just_me_and_kids") {
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
        | "just_me_and_kids"
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
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const toEventRow = (e: any) => {
    const visibility = (e as any).visibility as
      | "family"
      | "parents_only"
      | "just_me_and_kids"
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
        | "just_me_and_kids"
        | "private"
        | "family_read_only"
        | null
        | undefined;
      const legacyPrivate = e.description?.startsWith("[PRIVATE]") ?? false;
      if (visibility === "private") return e.created_by === user.id;
      if (visibility === "just_me_and_kids") return e.created_by === user.id;
      if (!visibility && legacyPrivate) return e.created_by === user.id;
      return true;
    })
    .map((e) => toEventRow(e));
  const eventsForModal: CalendarEventRow[] = [
    ...events,
    ...upcomingFullRows.filter((e) => !eventIdsInMonth.has(e.id)),
  ];

  // Precompute event dates for year view (by YYYY-MM-DD key).
  const eventsByDateKey = new Set<string>();
  for (const e of events) {
    const d = new Date(e.start_time);
    if (Number.isNaN(d.getTime())) continue;
    const y = d.getFullYear();
    const m = d.getMonth() + 1;
    const day = d.getDate();
    if (y !== safeYear) continue;
    const key = `${safeYear}-${String(m).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    eventsByDateKey.add(key);
  }

  const baseParams = new URLSearchParams();
  baseParams.set("year", String(safeYear));
  baseParams.set("month", String(safeMonth));

  function hrefForView(nextView: "month" | "list" | "year") {
    const params = new URLSearchParams(baseParams);
    if (nextView !== "month") {
      params.set("view", nextView);
    } else {
      params.delete("view");
    }
    const query = params.toString();
    return query ? `/calendar?${query}` : "/calendar";
  }

  const monthHref = hrefForView("month");
  const listHref = hrefForView("list");
  const yearHref = hrefForView("year");

  return (
    <div className="px-3 pt-3 pb-1 md:px-4 md:pt-4 md:pb-2">
      <div className="flex items-center gap-2 mb-1">
        <h1 className="font-heading text-xl md:text-2xl font-semibold text-foreground">
          Calendar
        </h1>
      </div>
      <p className="text-xs md:text-sm text-foreground-secondary mb-2">
        Shared record of parenting events.
      </p>
      {view === "year" && (
        <div className="mb-3 flex flex-wrap items-center justify-end gap-3">
          <CalendarExportButton
            view="year"
            year={safeYear}
            month={safeMonth}
            events={events}
          />
        </div>
      )}
      <div className="space-y-2.5">
        <div className="grid gap-3 lg:grid-cols-[460px_minmax(0,1fr)] items-start">
          <AddEventForm
            caseId={caseId}
            children={children ?? []}
            initialYear={safeYear}
            initialMonth={safeMonth}
          />
          {view === "year" ? (
            <div className="w-full min-w-0">
              <Card className="shadow-card">
                <CardHeader className="flex flex-col gap-2 space-y-0 pb-0.5">
                  <div className="flex items-center gap-3">
                    <Link
                      href={`/calendar?view=year&year=${safeYear - 1}`}
                      className="p-1 rounded-md hover:bg-muted"
                      aria-label="Previous year"
                    >
                      ←
                    </Link>
                    <h2 className="text-lg font-semibold">{safeYear}</h2>
                    <Link
                      href={`/calendar?view=year&year=${safeYear + 1}`}
                      className="p-1 rounded-md hover:bg-muted"
                      aria-label="Next year"
                    >
                      →
                    </Link>
                  </div>
                </CardHeader>
                <CardContent className="pt-0.5">
                  <CalendarYearView
                    year={safeYear}
                    eventDateKeys={Array.from(eventsByDateKey)}
                    custodySchedule={custodySchedule}
                    appMode={appMode}
                    userId={user.id}
                    caseId={caseId}
                  />
                </CardContent>
              </Card>
            </div>
          ) : (
            <div className="w-full min-w-0 space-y-3">
              <CalendarWithCustody
                caseId={caseId}
                userId={user.id}
                events={events}
                upcoming={upcoming}
                eventsForModal={eventsForModal}
                children={children ?? []}
                showUpcoming={view !== "list"}
                year={safeYear}
                month={safeMonth}
                appMode={appMode}
                holidays={holidays}
                kidsLabelUser={kidsLabelUser}
                kidsLabelCoparent={kidsLabelCoparent}
              />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
