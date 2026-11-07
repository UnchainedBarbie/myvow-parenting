import { createClient, getServiceRoleClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import Link from "next/link";
import { cn } from "@/lib/utils";
import { DashboardStatusCards } from "@/components/dashboard/dashboard-status-cards";
import { DashboardOnboardingGate } from "@/components/dashboard/dashboard-onboarding-gate";
import { EventRequestsCard } from "@/components/dashboard/event-requests-card";
import { CalendarNotices } from "@/components/dashboard/calendar-notices";
import { loadCalendarNoticeCards } from "@/lib/calendar/load-calendar-notices";
import { loadVisibleExpenses } from "@/lib/expenses-visibility";
import { eventVisibleOnCalendar } from "@/lib/calendar/event-visibility";
import {
  canonicalExpenseStatus,
  coparentPortion,
  expenseBalanceFigures,
  type ExpenseTabRow,
} from "@/lib/expenses-tab";
import { linkUnassignedParentMessages } from "@/lib/messages/deliver-parent-message";
import { presentMessageForViewer } from "@/lib/messages/parent-message-visibility";
type TodayEvent = {
  id: string;
  title: string;
  start_time: string;
  all_day: boolean;
  child_name: string | null;
  event_type: string | null;
};

function formatDateLabel(date: Date, timezone: string) {
  return date.toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
    timeZone: timezone,
  });
}

function formatTimeLabel(iso: string, timezone: string) {
  const d = new Date(iso);
  return d.toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    timeZone: timezone,
  });
}

function formatShortDay(date: Date, timezone: string) {
  return date.toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    timeZone: timezone,
  });
}

function formatAge(dateOfBirth: string | null): string {
  if (!dateOfBirth) return "—";
  try {
    const dob = new Date(dateOfBirth);
    const now = new Date();
    let years = now.getFullYear() - dob.getFullYear();
    const m = now.getMonth() - dob.getMonth();
    if (m < 0 || (m === 0 && now.getDate() < dob.getDate())) years -= 1;
    if (years < 0) return "—";
    return `${years} yrs`;
  } catch {
    return "—";
  }
}

function getGreetingLabel(name: string | null, timezone: string) {
  const now = new Date();
  const hour = Number(
    now.toLocaleString("en-US", {
      hour: "numeric",
      hour12: false,
      timeZone: timezone,
    })
  );
  let prefix = "Good day";
  if (hour >= 5 && hour < 12) prefix = "Good morning";
  else if (hour >= 12 && hour < 18) prefix = "Good afternoon";
  else prefix = "Good evening";
  return `${prefix}${name ? `, ${name.split(" ")[0]}` : ""}`;
}

export default async function DashboardPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: profile } = await supabase
    .from("users")
    .select("full_name, timezone")
    .eq("id", user.id)
    .single();

  const timezone =
    profile && typeof profile.timezone === "string"
      ? profile.timezone
      : "America/Denver";

  const admin = getServiceRoleClient();
  const { data: membership } = await admin
    .from("case_members")
    .select("case_id, is_primary, role")
    .eq("user_id", user.id)
    .limit(1)
    .maybeSingle();

  const caseId = membership?.case_id ?? null;

  const { data: safetyNotifications } = await admin
    .from("parent_notifications")
    .select("id, type, title, message, priority, read, created_at")
    .eq("user_id", user.id)
    .eq("type", "child_safety")
    .eq("read", false)
    .order("created_at", { ascending: false });

  const calendarCards = await loadCalendarNoticeCards(admin, user.id, timezone);

  if (!caseId) {
    const today = new Date();
    const todayLabel = formatDateLabel(today, timezone);
    const greeting = getGreetingLabel(profile?.full_name ?? null, timezone);
    return (
      <div className="px-3 pt-3 pb-1 md:px-4 md:pt-4 md:pb-2">
        <CalendarNotices cards={calendarCards} />
        {safetyNotifications && safetyNotifications.length > 0 && (
          <div className="mb-4 space-y-2">
            {safetyNotifications.map((n) => (
              <div
                key={n.id}
                className="rounded-card border border-[#C97B7B] bg-[#FDF2F2] px-4 py-3 text-sm text-[#7A3434]"
              >
                <p className="font-semibold mb-1">⚠️ {n.title}</p>
                <p className="text-xs text-[#7A3434] whitespace-pre-line">
                  {n.message}
                </p>
              </div>
            ))}
          </div>
        )}
        <div className="mb-4">
          <h1 className="font-heading text-xl md:text-2xl font-semibold text-foreground mb-1">
            {greeting}
          </h1>
          <p className="text-xs md:text-sm text-foreground-secondary">{todayLabel}</p>
        </div>
        <Card className="shadow-card border-border rounded-card">
          <CardHeader className="pb-2 px-4 pt-4">
            <CardTitle className="font-heading text-lg text-foreground">Welcome to MyVow</CardTitle>
          </CardHeader>
          <CardContent className="px-4 pb-4 space-y-3 text-sm text-foreground-secondary">
            <p>To see your dashboard, create or join a case from Settings.</p>
            <Button asChild size="sm" className="rounded-full h-8 text-xs mt-1">
              <Link href="/settings">Go to Settings</Link>
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  // Time ranges
  const now = new Date();
  const todayStart = new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate(),
    0,
    0,
    0,
    0
  ).toISOString();
  const todayEnd = new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate(),
    23,
    59,
    59,
    999
  ).toISOString();

  const eventColumns =
    "id, title, child_id, start_time, all_day, event_type, visibility, description, created_by, deleted_at";

  // Today events
  const { data: todayEventsRaw } = await admin
    .from("calendar_events")
    .select(eventColumns)
    .eq("case_id", caseId)
    .gte("start_time", todayStart)
    .lte("start_time", todayEnd)
    .is("deleted_at", null)
    .order("start_time", { ascending: true });

  // Next upcoming event this parent is allowed to see
  const { data: nextEventsRaw } = await admin
    .from("calendar_events")
    .select(eventColumns)
    .eq("case_id", caseId)
    .gt("start_time", todayEnd)
    .is("deleted_at", null)
    .order("start_time", { ascending: true });

  // Children for event labels
  const { data: childrenRaw } = await admin
    .from("children")
    .select("id, first_name, date_of_birth, deleted_at, profile_image")
    .eq("case_id", caseId)
    .is("deleted_at", null)
    .order("first_name");

  const childMap: Record<string, { first_name: string; date_of_birth: string | null; profile_image: string | null }> =
    (childrenRaw ?? []).reduce((acc, c) => {
      acc[c.id] = {
        first_name: c.first_name as string,
        date_of_birth: c.date_of_birth as string | null,
        profile_image: (c as any).profile_image as string | null ?? null,
      };
      return acc;
    }, {} as Record<string, { first_name: string; date_of_birth: string | null; profile_image: string | null }>);

  const todayEvents: TodayEvent[] = (todayEventsRaw ?? [])
    .filter((e) => eventVisibleOnCalendar(e, user.id))
    .map((e) => ({
    id: e.id as string,
    title: e.title as string,
    start_time: e.start_time as string,
    all_day: (e.all_day as boolean) ?? false,
    child_name: e.child_id ? childMap[e.child_id as string]?.first_name ?? null : null,
    event_type: (e.event_type as string | null) ?? null,
  }));

  const nextVisible = (nextEventsRaw ?? []).find((e) => eventVisibleOnCalendar(e, user.id));
  const nextEvent: TodayEvent | null = nextVisible
    ? {
        id: nextVisible.id as string,
        title: nextVisible.title as string,
        start_time: nextVisible.start_time as string,
        all_day: (nextVisible.all_day as boolean) ?? false,
        child_name: nextVisible.child_id
          ? childMap[nextVisible.child_id as string]?.first_name ?? null
          : null,
        event_type: (nextVisible.event_type as string | null) ?? null,
      }
    : null;

  // Pending event requests (from kids) — only those directed to this parent
  const isPrimary = membership?.is_primary === true;
  const { data: eventRequestsRaw } = await admin
    .from("event_requests")
    .select("id, requested_by_child_id, requested_date, requested_time, title, notes, photo_url, created_at, requested_parent")
    .eq("case_id", caseId)
    .eq("status", "pending")
    .is("deleted_at", null)
    .order("created_at", { ascending: false });
  const eventRequestsFiltered = (eventRequestsRaw ?? []).filter((r) => {
    const rp = (r as { requested_parent?: string | null }).requested_parent ?? "either";
    if (rp === "either") return true;
    if (rp === "user") return isPrimary;
    if (rp === "coparent") return !isPrimary;
    return true;
  });
  const childIds = [...new Set(eventRequestsFiltered.map((r) => r.requested_by_child_id).filter(Boolean))] as string[];
  const { data: childrenRows } = childIds.length > 0
    ? await admin.from("children").select("id, first_name").in("id", childIds)
    : { data: [] as { id: string; first_name: string }[] };
  const childNameById = new Map((childrenRows ?? []).map((c) => [c.id, c.first_name]));
  const eventRequests = eventRequestsFiltered.map((r) => ({
    id: r.id as string,
    requested_by_child_id: r.requested_by_child_id as string | null,
    requested_date: r.requested_date as string,
    requested_time: r.requested_time as string | null,
    title: r.title as string,
    notes: r.notes as string | null,
    photo_url: (r as { photo_url?: string | null }).photo_url ?? null,
    created_at: r.created_at as string,
    child_name: (r.requested_by_child_id && childNameById.get(r.requested_by_child_id as string)) ?? null,
  }));

  // Expenses: net balance + open items
  const balanceColumns =
    "id, amount, amount_owed, other_parent_share, split_label, submitted_by, status, paid_amount, deleted_at";
  const loadBalance = (columns: string) =>
    loadVisibleExpenses(
      (selected) =>
        admin.from("expenses").select(selected).eq("case_id", caseId).is("deleted_at", null),
      columns,
      { userId: user.id, role: membership?.role ?? null }
    );
  let balanceLoaded = await loadBalance(balanceColumns);
  if (balanceLoaded.error && /paid_amount/i.test(balanceLoaded.error.message ?? "")) {
    balanceLoaded = await loadBalance(balanceColumns.replace(", paid_amount", ""));
  }
  const expensesRaw = balanceLoaded.rows;
  const balanceRows: ExpenseTabRow[] = (expensesRaw ?? []).map((e) => ({
    amount: e.amount as string | number | null,
    amount_owed: e.amount_owed as string | number | null,
    other_parent_share: (e as { other_parent_share?: string | number | null }).other_parent_share ?? null,
    split_label: (e as { split_label?: string | null }).split_label ?? null,
    submitted_by: (e.submitted_by as string | null) ?? "",
    status: (e.status as string | null) ?? "",
    paid_amount: (e as { paid_amount?: string | number | null }).paid_amount ?? null,
  }));
  const expenseFigures = expenseBalanceFigures(balanceRows, user.id);
  let openExpenseItems = 0;
  for (const row of balanceRows) {
    const status = canonicalExpenseStatus(row.status);
    const share = coparentPortion(row);
    if ((status === "pending" || status === "disputed") && share != null && share > 0) {
      openExpenseItems += 1;
    }
  }

  // Messages over last 14 days for tone/communication status
  const twoWeeksAgo = new Date(now);
  twoWeeksAgo.setDate(now.getDate() - 14);
  await linkUnassignedParentMessages(admin, caseId);
  const { data: messagesLast14Raw } = await admin
    .from("messages")
    .select(
      "id, case_id, conversation_id, sender_id, direction, delivery_status, delivered_at, read_at, created_at"
    )
    .eq("case_id", caseId)
    .gte("created_at", twoWeeksAgo.toISOString())
    .order("created_at", { ascending: true });
  const messagesLast14 = (messagesLast14Raw ?? []) as {
    id: string;
    conversation_id: string | null;
    sender_id?: string | null;
    direction: "incoming" | "outgoing";
    delivery_status?: string | null;
    delivered_at?: string | null;
    read_at: string | null;
    created_at: string;
  }[];

  // Communication status: conversations awaiting response (last message incoming & unread)
  const lastMessageByConversation: Record<
    string,
    {
      direction: "incoming" | "outgoing";
      read_at: string | null;
      created_at: string;
    }
  > = {};
  for (const m of messagesLast14) {
    if (!m.conversation_id) continue;
    const view = presentMessageForViewer(m, user.id);
    if (!view.show) continue;
    const prev = lastMessageByConversation[m.conversation_id];
    if (!prev || new Date(m.created_at) > new Date(prev.created_at)) {
      lastMessageByConversation[m.conversation_id] = {
        direction: view.direction,
        read_at: m.read_at,
        created_at: m.created_at,
      };
    }
  }
  const awaitingResponseCount = Object.values(lastMessageByConversation).filter(
    (m) => m.direction === "incoming" && m.read_at == null
  ).length;
  const firstUnreadConversationId =
    Object.entries(lastMessageByConversation).find(
      ([_, m]) => m.direction === "incoming" && m.read_at == null
    )?.[0] ?? null;
  const communicationToneLabel =
    awaitingResponseCount === 0
      ? "No replies waiting"
      : `${awaitingResponseCount} conversation${
          awaitingResponseCount > 1 ? "s" : ""
        } may need a response`;

  const todayLabel = formatDateLabel(now, timezone);
  const greeting = getGreetingLabel(profile?.full_name ?? null, timezone);

  return (
    <div className="px-3 pt-3 pb-1 md:px-4 md:pt-4 md:pb-2">
      <CalendarNotices cards={calendarCards} />
      {safetyNotifications && safetyNotifications.length > 0 && (
        <div className="mb-4 space-y-2">
          {safetyNotifications.map((n) => (
            <div
              key={n.id}
              className="rounded-card border border-[#C97B7B] bg-[#FDF2F2] px-4 py-3 text-sm text-[#7A3434]"
            >
              <p className="font-semibold mb-1">⚠️ {n.title}</p>
              <p className="text-xs text-[#7A3434] whitespace-pre-line">
                {n.message}
              </p>
            </div>
          ))}
        </div>
      )}

      <div className="max-w-[1600px]">
          {/* Greeting header */}
          <div className="mb-4">
            <h1 className="font-heading text-xl md:text-2xl font-semibold text-foreground mb-1">
              {greeting}
            </h1>
            <p className="text-xs md:text-sm text-foreground-secondary">
              {todayLabel}
            </p>
            <p className="mt-1 text-xs md:text-sm text-foreground-secondary">
              Here&apos;s where things stand.
            </p>
          </div>

          <DashboardOnboardingGate
            contentAboveChecklist={
              <DashboardStatusCards
                caseId={caseId}
                openExpenseItems={openExpenseItems}
                awaitingResponseCount={awaitingResponseCount}
                communicationToneLabel={communicationToneLabel}
                firstUnreadConversationId={firstUnreadConversationId}
                agreedOutstandingLabel={expenseFigures.agreed.label}
                claimedAwaitingLabel={expenseFigures.claimed.label}
              />
            }
            contentBelowChecklist={
              <>
                {/* Quick actions */}
                <Card className="shadow-card border-border rounded-card">
              <CardHeader className="pb-2 px-4 pt-4">
                <CardTitle className="font-heading text-lg text-foreground">
                  Quick actions
                </CardTitle>
              </CardHeader>
              <CardContent className="px-4 pb-4">
                <div className="flex flex-row flex-wrap gap-2">
                  <Button
                    asChild
                    size="sm"
                    className="rounded-full h-8 text-xs bg-[#7B9E87] hover:bg-[#6A8A78] text-white"
                  >
                    <Link href="/messages">Send message</Link>
                  </Button>
                  <Button
                    asChild
                    size="sm"
                    className="rounded-full h-8 text-xs bg-[#7B9E87] hover:bg-[#6A8A78] text-white"
                  >
                    <Link href="/expenses">Add expense</Link>
                  </Button>
                  <Button
                    asChild
                    size="sm"
                    className="rounded-full h-8 text-xs bg-[#7B9E87] hover:bg-[#6A8A78] text-white"
                  >
                    <Link href="/documents">Upload document</Link>
                  </Button>
                  <Button
                    asChild
                    size="sm"
                    className="rounded-full h-8 text-xs bg-[#7B9E87] hover:bg-[#6A8A78] text-white"
                  >
                    <Link href="/calendar">Add calendar event</Link>
                  </Button>
                </div>
              </CardContent>
            </Card>

            {/* Today: events */}
            <Card className="rounded-card border border-[#E8E4DC] bg-[#FDFBF7]">
              <CardHeader className="pb-2 px-4 pt-4">
                <CardTitle className="font-heading text-lg text-foreground">
                  Today
                </CardTitle>
              </CardHeader>
              <CardContent className="px-4 pb-4">
                <div className="space-y-3">
                  {todayEvents.length === 0 ? (
                    <>
                      <p className="text-sm text-foreground-secondary">
                        Nothing scheduled today.
                      </p>
                      <Button
                        asChild
                        size="sm"
                        variant="outline"
                        className="rounded-full h-8 text-xs"
                      >
                        <Link href="/calendar">Open calendar</Link>
                      </Button>
                      {nextEvent && (
                        <p className="text-xs text-foreground-secondary mt-2">
                          <span className="font-medium text-foreground">
                            Next event:
                          </span>{" "}
                          {formatShortDay(
                            new Date(nextEvent.start_time),
                            timezone
                          )}{" "}
                          · {formatTimeLabel(nextEvent.start_time, timezone)} —{" "}
                          {nextEvent.title}
                          {nextEvent.child_name
                            ? ` (${nextEvent.child_name})`
                            : ""}
                        </p>
                      )}
                    </>
                  ) : (
                    <ul className="space-y-2">
                      {todayEvents
                        .slice()
                        .sort((a, b) =>
                          a.start_time.localeCompare(b.start_time)
                        )
                        .map((e) => (
                          <li
                            key={e.id}
                            className="flex items-start justify-between gap-2"
                          >
                            <div className="flex items-start gap-2">
                              <span
                                className={cn(
                                  "mt-1 h-2 w-2 rounded-full",
                                  e.event_type === "custody"
                                    ? "bg-[#7C8B6E]"
                                    : e.event_type === "medical"
                                      ? "bg-[#C97B7B]"
                                      : e.event_type === "school"
                                        ? "bg-[#D4A843]"
                                        : "bg-[#B0A899]"
                                )}
                              />
                              <div>
                                <p className="text-xs text-foreground-secondary">
                                  {(() => {
                                    const d = new Date(e.start_time);
                                    const hasSpecificTime =
                                      !(
                                        d.getHours() === 0 &&
                                        d.getMinutes() === 0
                                      );
                                    return hasSpecificTime
                                      ? formatTimeLabel(
                                          e.start_time,
                                          timezone
                                        )
                                      : "All day";
                                  })()}
                                </p>
                                <p className="text-sm font-medium text-foreground">
                                  {e.title}
                                </p>
                                {e.child_name && (
                                  <p className="text-xs text-foreground-secondary">
                                    {e.child_name}
                                  </p>
                                )}
                              </div>
                            </div>
                          </li>
                        ))}
                    </ul>
                  )}
                </div>
              </CardContent>
            </Card>

            {eventRequests.length > 0 && (
              <EventRequestsCard
                requests={eventRequests}
                caseId={caseId}
                children={(childrenRaw ?? []).map((c) => ({ id: c.id, first_name: c.first_name as string }))}
              />
            )}
              </>
            }
          />
      </div>
    </div>
  );
}
