/**
 * Decide whether a calendar proposal updates an existing event, offers to add one,
 * or asks which event. Does not write calendar_events.
 */

import { getServiceRoleClient } from "@/lib/supabase/server";
import type { Plan, Proposal } from "@/lib/sage/planner";
import { eventSubjectFromTexts } from "@/lib/sage/event-subject";
import { scheduleClocks } from "@/lib/sage/outbound-facts";

const STOPWORDS = new Set([
  "a",
  "an",
  "the",
  "and",
  "or",
  "to",
  "for",
  "of",
  "on",
  "at",
  "in",
  "with",
  "from",
  "by",
  "her",
  "his",
  "their",
  "your",
  "you",
  "youd",
  "like",
  "add",
  "move",
  "change",
  "update",
  "calendar",
  "event",
  "appointment",
  "please",
  "this",
  "that",
  "it",
  "is",
  "am",
  "pm",
  "into",
  "onto",
  "want",
  "me",
  "my",
  "our",
]);

type CalendarRow = {
  id: string;
  title: string | null;
  description: string | null;
  child_id: string | null;
  start_time: string;
  all_day: boolean | null;
  status: string | null;
};

export type CalendarFact = {
  id: string;
  title: string;
  description: string;
  /** Clock from start_time, such as "2:00 PM". Absent for all-day events. */
  timeLabel: string | null;
  dateLabel: string;
};

export type CalendarMatchInput = {
  caseId: string;
  timezone: string;
  iso: string;
  childIds: string[];
  summary: string;
  corpus: string;
  subject?: string | null;
  childName?: string | null;
  /** Facts already stated on the open reply or calendar proposal. */
  priorText?: string | null;
};

function significantWords(text: string): Set<string> {
  const cleaned = text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((word) => word.length > 2 && !STOPWORDS.has(word));
  return new Set(cleaned);
}

export function eventWordsOverlap(corpus: string, title: string): boolean {
  return sharesDistinctiveWord(significantWords(corpus), title);
}

function sharesDistinctiveWord(proposed: Set<string>, title: string): boolean {
  if (proposed.size === 0) return false;
  const words = significantWords(title);
  for (const word of proposed) {
    if (words.has(word)) return true;
  }
  return false;
}

function eventLabel(input: CalendarMatchInput): string {
  const subject =
    input.subject?.trim() ||
    eventSubjectFromTexts([input.corpus, input.summary]) ||
    "";
  const child = input.childName?.trim() || "";
  if (child && subject) return `${child}'s ${subject.toLowerCase()}`;
  if (subject) return subject.toLowerCase();
  return "that event";
}

type Ymd = { y: number; m: number; d: number };

function parseIso(iso: string): Ymd | null {
  const match = iso.trim().match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return null;
  return { y: Number(match[1]), m: Number(match[2]), d: Number(match[3]) };
}

function addDays(ymd: Ymd, delta: number): Ymd {
  const dt = new Date(Date.UTC(ymd.y, ymd.m - 1, ymd.d + delta, 12, 0, 0));
  return { y: dt.getUTCFullYear(), m: dt.getUTCMonth() + 1, d: dt.getUTCDate() };
}

function zonedTimeToUtc(
  ymd: Ymd,
  hour: number,
  minute: number,
  second: number,
  timeZone: string
): Date {
  let utc = Date.UTC(ymd.y, ymd.m - 1, ymd.d, hour, minute, second);
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  });
  for (let i = 0; i < 2; i++) {
    const parts = fmt.formatToParts(new Date(utc));
    const get = (type: string) =>
      Number(parts.find((p) => p.type === type)?.value ?? NaN);
    const asUtc = Date.UTC(
      get("year"),
      get("month") - 1,
      get("day"),
      get("hour"),
      get("minute"),
      get("second")
    );
    utc -= asUtc - utc;
  }
  return new Date(utc);
}

function formatDateLabel(iso: string, timezone: string): string {
  const ymd = parseIso(iso);
  if (!ymd) return iso;
  const noon = zonedTimeToUtc(ymd, 12, 0, 0, timezone);
  return new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    weekday: "long",
    month: "short",
    day: "numeric",
  }).format(noon);
}

function formatInstantDate(iso: string, timezone: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    weekday: "long",
    month: "short",
    day: "numeric",
  }).format(date);
}

function formatClock(iso: string, timezone: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    hour: "numeric",
    minute: "2-digit",
  }).format(date);
}

function ask(draft: string): Proposal {
  return {
    type: "ask_clarification",
    draft,
    depends_on: null,
    requires_approval: true,
  };
}

function compactHHmm(hhmm: string): string {
  const [hRaw, mRaw] = hhmm.split(":");
  const hour24 = Number(hRaw);
  const minute = Number(mRaw);
  if (!Number.isFinite(hour24) || !Number.isFinite(minute)) return hhmm;
  const hour12 = hour24 % 12 || 12;
  const suffix = hour24 >= 12 ? "pm" : "am";
  if (minute === 0) return `${hour12}${suffix}`;
  return `${hour12}:${String(minute).padStart(2, "0")}${suffix}`;
}

/** HH:mm of an instant in the case timezone. */
function zonedHHmm(iso: string, timezone: string): string | null {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const hour = parts.find((p) => p.type === "hour")?.value;
  const minute = parts.find((p) => p.type === "minute")?.value;
  if (hour == null || minute == null) return null;
  return `${hour}:${minute}`;
}

function ymdInZone(iso: string, timezone: string): string | null {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const year = parts.find((p) => p.type === "year")?.value;
  const month = parts.find((p) => p.type === "month")?.value;
  const day = parts.find((p) => p.type === "day")?.value;
  if (!year || !month || !day) return null;
  return `${year}-${month}-${day}`;
}

/**
 * Last start and last arrival in the text. A later clock replaces an earlier
 * one of the same role. Arrival never becomes the start.
 */
function requestedSchedule(text: string): { start: string | null; arrival: string | null } {
  let start: string | null = null;
  let arrival: string | null = null;
  for (const clock of scheduleClocks(text)) {
    const label = compactHHmm(clock.hhmm);
    if (clock.role === "arrival") arrival = label;
    else start = label;
  }
  return { start, arrival };
}

/** Arrival stored on the event, such as "Avery arrives 7:00 PM." Not the conversation. */
function arrivalOnRow(description: string | null): string | null {
  return requestedSchedule(description ?? "").arrival;
}

/** One sentence. The event, the date, and each time appear once. */
export function composeOfferSentence(input: {
  label: string;
  when: string;
  start: string | null;
  arrival: string | null;
}): string {
  let sentence = `Nothing on your calendar for ${input.label} on ${input.when}`;
  if (input.start) sentence += ` at ${input.start}`;
  if (input.arrival && input.arrival !== input.start) {
    sentence += `, arriving by ${input.arrival}`;
  }
  return `${sentence}. Want me to add it?`;
}

/**
 * Before values are the stored row. After values are what this turn asks for.
 * A matching pair is omitted so the sentence does not restate a fact.
 */
export function composeUpdateSentence(input: {
  label: string;
  dateFrom: string;
  dateTo: string | null;
  fromStart: string | null;
  toStart: string | null;
  fromArrival: string | null;
  toArrival: string | null;
}): string {
  const dateChanges = !!input.dateTo && input.dateTo !== input.dateFrom;
  const startChanges =
    !!input.fromStart && !!input.toStart && input.fromStart !== input.toStart;
  const arrivalChanges =
    !!input.fromArrival && !!input.toArrival && input.fromArrival !== input.toArrival;
  const arrivalAdds =
    !!input.toArrival && !input.fromArrival && input.toArrival !== input.toStart;

  if (!dateChanges && !startChanges && !arrivalChanges && !arrivalAdds) {
    return `Update ${input.label} on ${input.dateFrom}.`;
  }

  let sentence = dateChanges
    ? `Move ${input.label} from ${input.dateFrom} to ${input.dateTo}`
    : `Move ${input.label} on ${input.dateFrom}`;

  if (startChanges) {
    sentence += dateChanges
      ? `, from ${input.fromStart} to ${input.toStart}`
      : ` from ${input.fromStart} to ${input.toStart}`;
  } else if (!input.fromStart && input.toStart) {
    sentence += ` to ${input.toStart}`;
  }

  if (arrivalChanges) {
    sentence += `, arriving by ${input.fromArrival} to ${input.toArrival}`;
  } else if (arrivalAdds) {
    sentence += `, arriving by ${input.toArrival}`;
  }

  return `${sentence}.`;
}

async function loadCandidates(input: CalendarMatchInput): Promise<CalendarRow[] | null> {
  const ymd = parseIso(input.iso);
  if (!ymd) return [];
  const start = zonedTimeToUtc(addDays(ymd, -1), 0, 0, 0, input.timezone);
  const end = zonedTimeToUtc(addDays(ymd, 1), 23, 59, 59, input.timezone);
  const admin = getServiceRoleClient();
  const { data, error } = await admin
    .from("calendar_events")
    .select("id, title, description, child_id, start_time, all_day, status")
    .eq("case_id", input.caseId)
    .is("deleted_at", null)
    .gte("start_time", start.toISOString())
    .lte("start_time", end.toISOString());
  if (error) {
    console.error("[sage/calendar] lookup failed:", error.message);
    return null;
  }
  const namedChild = input.childIds.length > 0;
  return ((data ?? []) as CalendarRow[]).filter((row) => {
    const status = (row.status ?? "").toLowerCase();
    if (status === "canceled" || status === "cancelled") return false;
    if (!row.start_time) return false;
    if (!namedChild) return true;
    return row.child_id == null || input.childIds.includes(row.child_id);
  });
}

function outcomeFor(
  proposal: Proposal,
  input: CalendarMatchInput,
  rows: CalendarRow[] | null
): Proposal {
  const label = eventLabel(input);
  const when = formatDateLabel(input.iso, input.timezone);
  if (rows == null) {
    return ask(
      `I couldn't check the calendar for ${label} on ${when}. Want to tell me which event you mean?`
    );
  }
  const proposed = significantWords(`${input.summary} ${proposal.draft} ${input.corpus} ${input.priorText ?? ""}`);
  const hits = rows.filter((row) => sharesDistinctiveWord(proposed, row.title ?? ""));
  const offered = requestedSchedule(
    [input.priorText, proposal.draft, input.corpus].filter(Boolean).join("\n")
  );
  // The new value is this turn only. Earlier conversation clocks are not the "before".
  const requested = requestedSchedule(input.corpus);

  if (hits.length > 1) {
    const list = hits
      .map((row) => {
        const time = formatClock(row.start_time, input.timezone);
        const title = (row.title ?? "Untitled").trim() || "Untitled";
        return time ? `${title} at ${time}` : title;
      })
      .join("; ");
    return ask(
      `I found more than one event around ${when}: ${list}. Which one should I change?`
    );
  }

  if (hits.length === 1) {
    const hit = hits[0];
    const rowDate = formatInstantDate(hit.start_time, input.timezone) || when;
    const rowDay = ymdInZone(hit.start_time, input.timezone);
    const allDay = hit.all_day === true;
    const rowClock = allDay ? null : zonedHHmm(hit.start_time, input.timezone);
    return {
      ...proposal,
      type: "calendar_update",
      draft: composeUpdateSentence({
        label,
        dateFrom: rowDate,
        dateTo: rowDay && rowDay !== input.iso ? when : rowDate,
        fromStart: rowClock ? compactHHmm(rowClock) : null,
        toStart: requested.start,
        fromArrival: arrivalOnRow(hit.description),
        toArrival: requested.arrival,
      }),
      date: input.iso,
      calendar_intent: "update",
      calendar_event_id: hit.id,
    };
  }

  return {
    ...proposal,
    type: "calendar_update",
    draft: composeOfferSentence({
      label,
      when,
      start: offered.start,
      arrival: offered.arrival,
    }),
    date: input.iso,
    calendar_intent: "offer",
    calendar_event_id: null,
  };
}

/**
 * Same match the calendar check uses: case, not deleted, not canceled,
 * start_time within a day of the resolved date, child filter, one shared distinctive word.
 * Empty when there is no resolved date. Null when the query fails.
 */
export async function findMatchingEvents(
  input: CalendarMatchInput
): Promise<CalendarFact[] | null> {
  if (!input.iso || !parseIso(input.iso)) return [];
  const rows = await loadCandidates(input);
  if (rows == null) return null;
  const proposed = significantWords(
    `${input.summary} ${input.corpus} ${input.subject ?? ""}`
  );
  return rows
    .filter((row) => sharesDistinctiveWord(proposed, row.title ?? ""))
    .map((row) => {
      const title = (row.title ?? "").trim() || "Untitled";
      const allDay = row.all_day === true;
      const clock = formatClock(row.start_time, input.timezone);
      return {
        id: row.id,
        title,
        description: (row.description ?? "").trim(),
        timeLabel: allDay || !clock ? null : clock,
        dateLabel: formatInstantDate(row.start_time, input.timezone),
      };
    });
}

export async function reconcileCalendarPlan(
  plan: Plan,
  input: Omit<CalendarMatchInput, "iso"> & { iso: string | null }
): Promise<Plan> {
  if (!plan.proposals.some((p) => p.type === "calendar_update")) return plan;
  if (!input.iso) {
    return {
      ...plan,
      status: "awaiting_clarification",
      proposals: plan.proposals.map((p) =>
        p.type === "calendar_update"
          ? ask("Which date should I use?")
          : p
      ),
      reasoning: `${plan.reasoning} No resolved date, so no calendar proposal.`.trim(),
    };
  }
  const rows = await loadCandidates({ ...input, iso: input.iso });
  return {
    ...plan,
    proposals: plan.proposals.map((p) =>
      p.type === "calendar_update" ? outcomeFor(p, { ...input, iso: input.iso as string }, rows) : p
    ),
  };
}
