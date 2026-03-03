import { createClient, getServiceRoleClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import Link from "next/link";
import { cn } from "@/lib/utils";
import { DashboardStatusCards } from "@/components/dashboard/dashboard-status-cards";

type TodayEvent = {
  id: string;
  title: string;
  start_time: string;
  all_day: boolean;
  child_name: string | null;
};

type WeekDaySummary = {
  date: Date;
  events: TodayEvent[];
};

type ChildSummary = {
  id: string;
  first_name: string;
  date_of_birth: string | null;
  ageLabel: string;
  nextEvent: TodayEvent | null;
  profile_image?: string | null;
  lastUpdateLabel?: string | null;
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
    (profile?.timezone as string | null) && typeof profile.timezone === "string"
      ? profile.timezone
      : "America/Denver";

  const admin = getServiceRoleClient();
  const { data: membership } = await admin
    .from("case_members")
    .select("case_id")
    .eq("user_id", user.id)
    .limit(1)
    .maybeSingle();

  const caseId = membership?.case_id ?? null;

  if (!caseId) {
    const today = new Date();
    const todayLabel = formatDateLabel(today, timezone);
    const greeting = getGreetingLabel(profile?.full_name ?? null, timezone);
    return (
      <div className="px-3 pt-3 pb-1 md:px-4 md:pt-4 md:pb-2">
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

  const weekDays: Date[] = [];
  for (let i = 0; i < 7; i++) {
    const d = new Date(now);
    d.setDate(now.getDate() + i);
    weekDays.push(d);
  }
  const weekStart = new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate(),
    0,
    0,
    0,
    0
  ).toISOString();
  const weekEndDate = new Date(now);
  weekEndDate.setDate(now.getDate() + 6);
  const weekEnd = new Date(
    weekEndDate.getFullYear(),
    weekEndDate.getMonth(),
    weekEndDate.getDate(),
    23,
    59,
    59,
    999
  ).toISOString();

  // Today events
  const { data: todayEventsRaw } = await admin
    .from("calendar_events")
    .select("id, title, child_id, start_time, all_day, deleted_at")
    .eq("case_id", caseId)
    .gte("start_time", todayStart)
    .lte("start_time", todayEnd)
    .is("deleted_at", null)
    .order("start_time", { ascending: true });

  // This week events
  const { data: weekEventsRaw } = await admin
    .from("calendar_events")
    .select("id, title, child_id, start_time, all_day, deleted_at")
    .eq("case_id", caseId)
    .gte("start_time", weekStart)
    .lte("start_time", weekEnd)
    .is("deleted_at", null)
    .order("start_time", { ascending: true });

  const eventsAll = [...(todayEventsRaw ?? []), ...(weekEventsRaw ?? [])];
  const eventChildIds = [
    ...new Set(
      eventsAll
        .map((e) => e.child_id as string | null)
        .filter((id): id is string => !!id)
    ),
  ];

  // Children for kids summary and event labels
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
        date_of_birth: (c.date_of_birth as string | null) ?? null,
        profile_image: (c.profile_image as string | null) ?? null,
      };
      return acc;
    }, {} as Record<string, { first_name: string; date_of_birth: string | null }>);

  const todayEvents: TodayEvent[] = (todayEventsRaw ?? []).map((e) => ({
    id: e.id as string,
    title: e.title as string,
    start_time: e.start_time as string,
    all_day: (e.all_day as boolean) ?? false,
    child_name: e.child_id ? childMap[e.child_id as string]?.first_name ?? null : null,
  }));

  const weekEvents: TodayEvent[] = (weekEventsRaw ?? []).map((e) => ({
    id: e.id as string,
    title: e.title as string,
    start_time: e.start_time as string,
    all_day: (e.all_day as boolean) ?? false,
    child_name: e.child_id ? childMap[e.child_id as string]?.first_name ?? null : null,
  }));

  const weekByDay: WeekDaySummary[] = weekDays.map((day) => {
    const dayStart = new Date(
      day.getFullYear(),
      day.getMonth(),
      day.getDate(),
      0,
      0,
      0,
      0
    );
    const dayEnd = new Date(
      day.getFullYear(),
      day.getMonth(),
      day.getDate(),
      23,
      59,
      59,
      999
    );
    const eventsForDay = weekEvents.filter((e) => {
      const d = new Date(e.start_time);
      return d >= dayStart && d <= dayEnd;
    });
    return { date: day, events: eventsForDay };
  });

  // Review uploads: pending email-to-MyVow items
  const { data: uploadsRaw } = await admin
    .from("inbound_uploads")
    .select("id, subject, created_at")
    .eq("user_id", user.id)
    .eq("status", "pending_review")
    .order("created_at", { ascending: false })
    .limit(5);

  const pendingUploads = (uploadsRaw ?? []) as {
    id: string;
    subject: string | null;
    created_at: string;
  }[];
  const uploadsCount = pendingUploads.length;
  const uploadsRecent = pendingUploads.slice(0, 3);

  // Expenses: net balance + open items
  const { data: expensesRaw } = await admin
    .from("expenses")
    .select("id, amount, amount_owed, submitted_by, status, deleted_at")
    .eq("case_id", caseId)
    .is("deleted_at", null);

  let totalOwedToYou = 0;
  let totalYouOwe = 0;
  let openExpenseItems = 0;
  for (const e of expensesRaw ?? []) {
    const amountNum = Number(e.amount);
    const owedNum =
      (e.amount_owed as number | null | undefined) != null
        ? Number(e.amount_owed)
        : null;
    if ((e.status as string | null) !== "resolved") {
      openExpenseItems += 1;
    }
    if (Number.isNaN(amountNum) || owedNum == null || Number.isNaN(owedNum)) continue;
    if (e.submitted_by === user.id) {
      totalOwedToYou += owedNum;
    } else {
      totalYouOwe += owedNum;
    }
  }
  const net = totalOwedToYou - totalYouOwe;
  const netLabel =
    net > 0.01
      ? `You are owed $${net.toFixed(2)}`
      : net < -0.01
        ? `You owe $${Math.abs(net).toFixed(2)}`
        : "You are all settled";

  // Messages over last 14 days for tone/communication status
  const twoWeeksAgo = new Date(now);
  twoWeeksAgo.setDate(now.getDate() - 14);
  const oneWeekAgo = new Date(now);
  oneWeekAgo.setDate(now.getDate() - 7);
  const { data: messagesLast14Raw } = await admin
    .from("messages")
    .select(
      "id, case_id, conversation_id, direction, read_at, created_at, ai_classification, emotional_intensity_score"
    )
    .eq("case_id", caseId)
    .gte("created_at", twoWeeksAgo.toISOString())
    .order("created_at", { ascending: true });
  const messagesLast14 = (messagesLast14Raw ?? []) as {
    id: string;
    conversation_id: string | null;
    direction: "incoming" | "outgoing";
    read_at: string | null;
    created_at: string;
    ai_classification: string | null;
    emotional_intensity_score: number | null;
  }[];

  function isElevated(m: {
    ai_classification: string | null;
    emotional_intensity_score: number | null;
  }) {
    const cls = (m.ai_classification ?? "").toLowerCase();
    const intensity =
      typeof m.emotional_intensity_score === "number"
        ? Number(m.emotional_intensity_score)
        : 0;
    if (
      cls === "escalatory" ||
      cls === "threatening" ||
      cls === "coercive" ||
      cls === "manipulative"
    ) {
      return true;
    }
    return intensity >= 0.7;
  }

  const messagesPrevWeek = messagesLast14.filter((m) => {
    const d = new Date(m.created_at);
    return d >= twoWeeksAgo && d < oneWeekAgo;
  });
  const messagesThisWeek = messagesLast14.filter((m) => {
    const d = new Date(m.created_at);
    return d >= oneWeekAgo && d <= now;
  });

  const elevatedPrevWeek = messagesPrevWeek.filter(isElevated).length;
  const elevatedThisWeek = messagesThisWeek.filter(isElevated).length;
  const householdElevated = elevatedThisWeek > 0;

  const householdClimateLabel = householdElevated
    ? "More active this week"
    : "Steady this week";
  const disputesLabel =
    openExpenseItems === 0
      ? "No open disputes"
      : openExpenseItems === 1
        ? "1 unresolved expense item"
        : `${openExpenseItems} unresolved expense items`;

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
    const prev = lastMessageByConversation[m.conversation_id];
    if (!prev || new Date(m.created_at) > new Date(prev.created_at)) {
      lastMessageByConversation[m.conversation_id] = {
        direction: m.direction,
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
  const communicationMainLabel = "All conversations up to date";
  const communicationToneLabel =
    awaitingResponseCount === 0
      ? "No replies waiting"
      : `${awaitingResponseCount} conversation${
          awaitingResponseCount > 1 ? "s" : ""
        } may need a response`;

  // Recent child-related updates from conversations and calendar
  const { data: convRaw } = await admin
    .from("conversations")
    .select("id, child_id, subject, updated_at")
    .eq("case_id", caseId)
    .not("child_id", "is", null)
    .order("updated_at", { ascending: false })
    .limit(100);
  const convLatestByChild: Record<
    string,
    { subject: string; updated_at: string }
  > = {};
  for (const row of convRaw ?? []) {
    const childId = (row.child_id as string) ?? null;
    if (!childId) continue;
    if (!convLatestByChild[childId]) {
      convLatestByChild[childId] = {
        subject: (row.subject as string) ?? "",
        updated_at: (row.updated_at as string) ?? "",
      };
    }
  }

  const { data: allChildEventsRaw } = await admin
    .from("calendar_events")
    .select("id, title, child_id, start_time, deleted_at")
    .eq("case_id", caseId)
    .is("deleted_at", null)
    .order("start_time", { ascending: false })
    .limit(100);
  const eventLatestByChild: Record<
    string,
    { title: string; start_time: string }
  > = {};
  for (const row of allChildEventsRaw ?? []) {
    const childId = (row.child_id as string) ?? null;
    if (!childId) continue;
    if (!eventLatestByChild[childId]) {
      eventLatestByChild[childId] = {
        title: (row.title as string) ?? "",
        start_time: (row.start_time as string) ?? "",
      };
    }
  }

  // Kids snapshot
  const childrenSummaries: ChildSummary[] = (childrenRaw ?? []).map((c) => {
    const id = c.id as string;
    const upcomingForChild = weekEvents
      .filter((e) => {
        const childName =
          e.child_name ?? (childMap[id]?.first_name ?? null);
        return (
          (e.child_name && childName === childMap[id]?.first_name) ||
          (!e.child_name && false)
        );
      })
      .sort(
        (a, b) =>
          new Date(a.start_time).getTime() - new Date(b.start_time).getTime()
      )[0] ?? null;
    const latestConv = convLatestByChild[id] ?? null;
    const latestEvent = eventLatestByChild[id] ?? null;
    let lastUpdateLabel: string | null = null;
    if (latestConv || latestEvent) {
      const convDate = latestConv ? new Date(latestConv.updated_at) : null;
      const eventDate = latestEvent ? new Date(latestEvent.start_time) : null;
      if (eventDate && (!convDate || eventDate >= convDate)) {
        lastUpdateLabel = `${latestEvent?.title ?? "Event"} ${eventDate.toLocaleDateString(
          "en-US",
          { month: "short", day: "numeric" }
        )}`;
      } else if (convDate) {
        lastUpdateLabel = `${latestConv?.subject ?? "Conversation"} ${convDate.toLocaleDateString(
          "en-US",
          { month: "short", day: "numeric" }
        )}`;
      }
    }
    return {
      id,
      first_name: c.first_name as string,
      date_of_birth: (c.date_of_birth as string | null) ?? null,
      ageLabel: formatAge((c.date_of_birth as string | null) ?? null),
      nextEvent: upcomingForChild,
      profile_image: (c.profile_image as string | null) ?? null,
      lastUpdateLabel,
    };
  });

  const todayLabel = formatDateLabel(now, timezone);
  const greeting = getGreetingLabel(profile?.full_name ?? null, timezone);

  return (
    <div className="px-3 pt-3 pb-1 md:px-4 md:pt-4 md:pb-2">
      {/* Greeting header */}
      <div className="mb-4">
        <h1 className="font-heading text-xl md:text-2xl font-semibold text-foreground mb-1">
          {greeting}
        </h1>
        <p className="text-xs md:text-sm text-foreground-secondary">{todayLabel}</p>
        <p className="mt-1 text-xs md:text-sm text-foreground-secondary">
          Here&apos;s where things stand.
        </p>
      </div>

      <div className="space-y-4">
        {/* Top row: status cards */}
        <DashboardStatusCards
          householdElevated={householdElevated}
          householdClimateLabel={householdClimateLabel}
          disputesLabel={disputesLabel}
          openExpenseItems={openExpenseItems}
          awaitingResponseCount={awaitingResponseCount}
          communicationMainLabel={communicationMainLabel}
          communicationToneLabel={communicationToneLabel}
          firstUnreadConversationId={firstUnreadConversationId}
          netLabel={netLabel}
        />

        {/* Row 1: Today's events + This week */}
        <div className="grid gap-4 lg:grid-cols-2 items-start">
          <Card className="rounded-card border border-[#E8E4DC] bg-[#FDFBF7]">
            <CardHeader className="pb-2 px-4 pt-4">
              <CardTitle className="font-heading text-lg text-foreground">
                Today&apos;s events
              </CardTitle>
            </CardHeader>
            <CardContent className="px-4 pb-4 space-y-3">
              {todayEvents.length === 0 ? (
                <p className="text-sm text-foreground-secondary">
                  Nothing scheduled today.
                </p>
              ) : (
                <ul className="space-y-2">
                  {todayEvents.map((e) => (
                    <li key={e.id} className="flex items-start justify-between gap-2">
                      <div>
                        <p className="text-xs text-foreground-secondary">
                          {(() => {
                            const d = new Date(e.start_time);
                            const hasSpecificTime =
                              !(d.getHours() === 0 && d.getMinutes() === 0);
                            return hasSpecificTime
                              ? formatTimeLabel(e.start_time, timezone)
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
                    </li>
                  ))}
                </ul>
              )}
              <Button
                asChild
                size="sm"
                variant="outline"
                className="rounded-full h-8 text-xs mt-1"
              >
                <Link href="/calendar">Open calendar</Link>
              </Button>
            </CardContent>
          </Card>

          <Card className="rounded-card border border-[#E8E4DC] bg-[#FDFBF7]">
            <CardHeader className="pb-2 px-4 pt-4">
              <CardTitle className="font-heading text-lg text-foreground">
                This week
              </CardTitle>
            </CardHeader>
            <CardContent className="px-4 pb-4 space-y-3">
              {weekByDay.length === 0 ? (
                <p className="text-sm text-foreground-secondary">
                  No events scheduled this week.
                </p>
              ) : (
                <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-2 text-xs">
                  {weekByDay.map((d) => (
                    <div
                      key={d.date.toISOString()}
                      className={cn(
                        "rounded-card border border-[#E8E4DC] bg-background-secondary/60 px-2 py-1.5 space-y-1 min-w-0",
                        d.date.toDateString() === now.toDateString() &&
                          "border-[#E8E4DC] bg-[#F5F0E8]"
                      )}
                    >
                      <p className="font-medium text-foreground truncate">
                        {formatShortDay(d.date, timezone)}
                      </p>
                      {d.events.length === 0 ? (
                        <p className="text-[11px] text-foreground-secondary">
                          No events
                        </p>
                      ) : (
                        <>
                          <p className="text-[11px] text-foreground-secondary">
                            {d.events.length === 1
                              ? "1 event"
                              : `${d.events.length} events`}
                          </p>
                          <p className="text-[11px] text-foreground truncate">
                            {d.events[0].title}
                          </p>
                        </>
                      )}
                    </div>
                  ))}
                </div>
              )}
              <Button
                asChild
                size="sm"
                variant="outline"
                className="rounded-full h-8 text-xs mt-1"
              >
                <Link href="/calendar">View full calendar</Link>
              </Button>
            </CardContent>
          </Card>
        </div>

        {/* Row 2: Review + Kids snapshot */}
        <div className="grid gap-4 lg:grid-cols-2 items-start">
          <Card className="shadow-card border-border rounded-card">
            <CardHeader className="pb-2 px-4 pt-4 flex items-center justify-between gap-2">
              <CardTitle className="font-heading text-lg text-foreground">
                Review
              </CardTitle>
            </CardHeader>
            <CardContent className="px-4 pb-4 space-y-3">
              {uploadsCount === 0 ? (
                <p className="text-sm text-foreground-secondary">All caught up.</p>
              ) : (
                <div className="flex items-center justify-between gap-3">
                  <p className="text-sm text-foreground-secondary">
                    {uploadsCount} item{uploadsCount > 1 ? "s" : ""} to review
                  </p>
                  <Button
                    asChild
                    size="sm"
                    className="rounded-full h-8 text-xs bg-[#7B9E87] hover:bg-[#6A8A78] text-white"
                  >
                    <Link href="/uploads/review">Review now</Link>
                  </Button>
                </div>
              )}
            </CardContent>
          </Card>

          <Card className="shadow-card border-border rounded-card">
            <CardHeader className="pb-2 px-4 pt-4">
              <CardTitle className="font-heading text-lg text-foreground">
                Kids Snapshot
              </CardTitle>
            </CardHeader>
            <CardContent className="px-4 pb-4 space-y-3">
              {childrenSummaries.length === 0 ? (
                <p className="text-sm text-foreground-secondary">
                  Add children from the Profile page to see their schedules here.
                </p>
              ) : (
                <ul className="space-y-2">
                  {childrenSummaries.map((c) => (
                    <li
                      key={c.id}
                      className="flex items-start justify-between gap-2 rounded-card border border-border bg-background-secondary/60 px-3 py-2"
                    >
                      <div className="flex items-center gap-2">
                        {c.profile_image ? (
                          <img
                            src={c.profile_image}
                            alt={c.first_name}
                            className="h-7 w-7 rounded-full object-cover border border-border/60 bg-emerald-50"
                          />
                        ) : (
                          <div className="h-7 w-7 rounded-full bg-emerald-50 text-emerald-800 flex items-center justify-center text-xs font-medium">
                            {c.first_name?.charAt(0).toUpperCase() ?? ""}
                          </div>
                        )}
                        <div>
                          <p className="text-sm font-medium text-foreground">
                            {c.first_name}
                          </p>
                          <p className="text-xs text-foreground-secondary">
                            {c.ageLabel}
                          </p>
                        </div>
                      </div>
                      <div className="text-right max-w-[60%]">
                        <p className="text-[11px] text-foreground-secondary mb-0.5">
                          Next event
                        </p>
                        {c.nextEvent ? (
                          <>
                            <p className="text-xs text-foreground truncate">
                              {c.nextEvent.title}
                            </p>
                            <p className="text-[11px] text-foreground-secondary">
                              {formatShortDay(
                                new Date(c.nextEvent.start_time),
                                timezone
                              )}
                            </p>
                          </>
                        ) : (
                          <p className="text-xs text-foreground-secondary">
                            None scheduled
                          </p>
                        )}
                        <p className="mt-1 text-[11px] text-foreground-secondary">
                          Last update:{" "}
                          {c.lastUpdateLabel ?? "No recent updates"}
                        </p>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
        </div>

        {/* Row 3: Quick actions */}
        <div className="grid gap-4 lg:grid-cols-2 items-start">
          <Card className="shadow-card border-border rounded-card">
            <CardHeader className="pb-2 px-4 pt-4">
              <CardTitle className="font-heading text-lg text-foreground">
                Quick actions
              </CardTitle>
            </CardHeader>
            <CardContent className="px-4 pb-4">
              <div className="flex flex-wrap gap-2">
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
        </div>
      </div>
    </div>
  );
}
