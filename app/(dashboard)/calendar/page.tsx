import { createClient, getServiceRoleClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { AddEventForm } from "@/components/calendar/add-event-form";
import { CalendarMonth, type CalendarEventRow } from "@/components/calendar/calendar-month";

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
          Shared parenting calendar, custody schedule, and swap requests.
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
    .select("id, first_name")
    .eq("case_id", caseId)
    .order("first_name");

  const { start, end } = getMonthRange(safeYear, safeMonth);
  const { data: eventsRaw } = await admin
    .from("calendar_events")
    .select(
      "id, title, description, event_type, child_id, start_time, end_time, all_day"
    )
    .eq("case_id", caseId)
    .gte("start_time", start)
    .lte("start_time", end)
    .order("start_time", { ascending: true });

  const childIds = [
    ...new Set(
      (eventsRaw ?? []).map((e) => e.child_id).filter(Boolean)
    ),
  ] as string[];
  const { data: childRows } =
    childIds.length > 0
      ? await admin.from("children").select("id, first_name").in("id", childIds)
      : { data: [] };
  const childMap = (childRows ?? []).reduce(
    (acc, c) => {
      acc[c.id] = c.first_name;
      return acc;
    },
    {} as Record<string, string>
  );

  const events: CalendarEventRow[] = (eventsRaw ?? []).map((e) => ({
    id: e.id,
    title: e.title,
    description: e.description,
    event_type: e.event_type,
    child_id: e.child_id,
    child_name: e.child_id ? childMap[e.child_id] ?? null : null,
    start_time: e.start_time,
    end_time: e.end_time,
    all_day: e.all_day ?? false,
  }));

  return (
    <div className="p-6 md:p-8">
      <h1 className="font-heading text-2xl font-semibold text-foreground mb-2">
        Calendar
      </h1>
      <p className="text-foreground-secondary mb-8">
        Shared parenting calendar. Add medical, school, extracurricular, custody
        exchange, and therapy events.
      </p>
      <div className="space-y-8">
        <div className="grid gap-8 lg:grid-cols-[320px_1fr]">
          <AddEventForm
            caseId={caseId}
            children={children ?? []}
            initialYear={safeYear}
            initialMonth={safeMonth}
          />
          <CalendarMonth
            year={safeYear}
            month={safeMonth}
            events={events}
          />
        </div>
      </div>
    </div>
  );
}
