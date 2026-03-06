import { createClient, getServiceRoleClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import Link from "next/link";
import { AddEventForm } from "@/components/calendar/add-event-form";
import type { CalendarEventRow } from "@/components/calendar/calendar-month";
import { CalendarRoot } from "@/components/calendar/calendar-root";
import { CalendarInboxButton } from "@/components/calendar/calendar-inbox-button";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { CalendarExportButton } from "@/components/calendar/calendar-export-button";

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

  const { start, end } =
    view === "year" ? getYearRange(safeYear) : getMonthRange(safeYear, safeMonth);
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

  const today = new Date();
  const todayYear = today.getFullYear();
  const todayMonth = today.getMonth() + 1;
  const todayDate = today.getDate();

  const baseParams = new URLSearchParams();
  baseParams.set("year", String(safeYear));
  baseParams.set("month", String(safeMonth));
  if (searchParams.from) baseParams.set("from", searchParams.from);
  if (searchParams.to) baseParams.set("to", searchParams.to);

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

  // List view date range (default: today -> +30 days)
  const defaultFromDate = new Date(
    today.getFullYear(),
    today.getMonth(),
    today.getDate(),
    0,
    0,
    0,
    0
  );
  const defaultToDate = new Date(defaultFromDate);
  defaultToDate.setDate(defaultToDate.getDate() + 30);

  function normalizeDateParam(value: string | undefined, fallback: Date): string {
    if (!value) return fallback.toISOString().slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return fallback.toISOString().slice(0, 10);
    return value;
  }

  const listFromStr = normalizeDateParam(
    searchParams.from,
    defaultFromDate
  );
  const listToStr = normalizeDateParam(
    searchParams.to,
    defaultToDate
  );

  const listFromDate = new Date(listFromStr);
  const listToDate = new Date(listToStr);
  if (!Number.isNaN(listToDate.getTime())) {
    listToDate.setHours(23, 59, 59, 999);
  }

  const inListRange = (iso: string | null | undefined): boolean => {
    if (!iso) return false;
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return false;
    if (Number.isNaN(listFromDate.getTime()) || Number.isNaN(listToDate.getTime())) {
      return true;
    }
    return d >= listFromDate && d <= listToDate;
  };

  const filteredUpcoming = view === "list"
    ? upcoming.filter((e) => inListRange(e.start_time))
    : upcoming;

  const filteredEventsForModal = view === "list"
    ? eventsForModal.filter((e) => inListRange(e.start_time))
    : eventsForModal;

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
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <div className="inline-flex rounded-full border border-[#E8E4DC] bg-[#FDFBF7] p-0.5 text-xs">
          <Link
            href={monthHref}
            className={`px-3 py-1.5 rounded-full ${
              view === "month"
                ? "bg-white text-[#3D3D3D] border border-[#7C8B6E]"
                : "text-foreground-secondary"
            }`}
          >
            Month
          </Link>
          <Link
            href={listHref}
            className={`px-3 py-1.5 rounded-full ${
              view === "list"
                ? "bg-white text-[#3D3D3D] border border-[#7C8B6E]"
                : "text-foreground-secondary"
            }`}
          >
            List
          </Link>
          <Link
            href={yearHref}
            className={`px-3 py-1.5 rounded-full ${
              view === "year"
                ? "bg-white text-[#3D3D3D] border border-[#7C8B6E]"
                : "text-foreground-secondary"
            }`}
          >
            Year
          </Link>
        </div>
        <CalendarExportButton
          view={view}
          year={safeYear}
          month={safeMonth}
          events={events}
          listEvents={filteredEventsForModal}
        />
      </div>
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
              <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
                {Array.from({ length: 12 }).map((_, index) => {
                  const monthNumber = index + 1;
                  const firstDay = new Date(safeYear, monthNumber - 1, 1).getDay(); // 0=Sun
                  const daysInMonth = new Date(safeYear, monthNumber, 0).getDate();
                  const blanks = Array.from({ length: firstDay });
                  const days = Array.from({ length: daysInMonth }, (_, i) => i + 1);
                  const monthName = new Date(
                    safeYear,
                    monthNumber - 1,
                    1
                  ).toLocaleString("en-US", { month: "short" });

                  return (
                    <div
                      key={monthNumber}
                      className="rounded-card border border-[#E8E4DC] bg-[#FDFBF7] p-3 flex flex-col gap-2"
                    >
                      <div className="text-xs font-semibold text-foreground mb-1">
                        {monthName} {safeYear}
                      </div>
                      <div className="grid grid-cols-7 gap-1 text-[10px] text-foreground-secondary">
                        {["S", "M", "T", "W", "T", "F", "S"].map((d) => (
                          <div
                            key={d}
                            className="flex items-center justify-center h-5"
                          >
                            {d}
                          </div>
                        ))}
                      </div>
                      <div className="grid grid-cols-7 gap-1 text-[11px]">
                        {blanks.map((_, i) => (
                          <div key={`b-${i}`} className="h-6" />
                        ))}
                        {days.map((day) => {
                          const key = `${safeYear}-${String(monthNumber).padStart(
                            2,
                            "0"
                          )}-${String(day).padStart(2, "0")}`;
                          const hasEvent = eventsByDateKey.has(key);
                          const isToday =
                            safeYear === todayYear &&
                            monthNumber === todayMonth &&
                            day === todayDate;
                          const dayClasses =
                            "flex flex-col items-center justify-center h-7 w-7 mx-auto rounded-full";
                          const activeClasses = isToday
                            ? "bg-[#EEF2E9] text-[#5B7A52]"
                            : "text-foreground";

                          const params = new URLSearchParams();
                          params.set("year", String(safeYear));
                          params.set("month", String(monthNumber));
                          const href = `/calendar?${params.toString()}`;

                          return (
                            <Link
                              key={day}
                              href={href}
                              className="flex flex-col items-center gap-0.5"
                            >
                              <div className={`${dayClasses} ${activeClasses}`}>
                                {day}
                              </div>
                              {hasEvent && (
                                <div className="h-1.5 w-1.5 rounded-full bg-[#7C8B6E]" />
                              )}
                            </Link>
                          );
                        })}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          ) : (
            <div className="w-full min-w-0 space-y-3">
              {view === "list" && (
                <form
                  method="get"
                  className="rounded-card border border-[#E8E4DC] bg-[#FDFBF7] px-3 py-2 flex flex-wrap items-end gap-3"
                >
                  <input type="hidden" name="year" value={safeYear} />
                  <input type="hidden" name="month" value={safeMonth} />
                  <input type="hidden" name="view" value="list" />
                  <div className="space-y-1">
                    <Label className="text-[11px] text-foreground-secondary">
                      From
                    </Label>
                    <input
                      type="date"
                      name="from"
                      defaultValue={listFromStr}
                      className="h-8 rounded-md border border-[#E8E4DC] bg-white px-2 text-xs text-[#3D3D3D]"
                    />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-[11px] text-foreground-secondary">
                      To
                    </Label>
                    <input
                      type="date"
                      name="to"
                      defaultValue={listToStr}
                      className="h-8 rounded-md border border-[#E8E4DC] bg-white px-2 text-xs text-[#3D3D3D]"
                    />
                  </div>
                  <div className="ml-auto">
                    <Button
                      type="submit"
                      size="sm"
                      className="h-8 rounded-full text-xs bg-[#7B9E87] hover:bg-[#6A8A78] text-white"
                    >
                      Apply
                    </Button>
                  </div>
                </form>
              )}
              <CalendarRoot
                caseId={caseId}
                events={events}
                upcoming={filteredUpcoming}
                eventsForModal={filteredEventsForModal}
                children={children ?? []}
              />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
