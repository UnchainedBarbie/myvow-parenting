/**
 * Decide whether a calendar proposal updates an existing event, offers to add one,
 * or asks which event. Does not write calendar_events.
 */

import { getServiceRoleClient } from "@/lib/supabase/server";
import type { Plan, Proposal } from "@/lib/sage/planner";
import { parseClockMinutes } from "@/lib/sage/resolver";

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
  child_id: string | null;
  start_time: string;
  status: string | null;
};

export type CalendarMatchInput = {
  caseId: string;
  timezone: string;
  iso: string;
  childIds: string[];
  summary: string;
  corpus: string;
};

function significantWords(text: string): Set<string> {
  const cleaned = text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((word) => word.length > 2 && !STOPWORDS.has(word));
  return new Set(cleaned);
}

function sharesDistinctiveWord(proposed: Set<string>, title: string): boolean {
  if (proposed.size === 0) return false;
  const words = significantWords(title);
  for (const word of proposed) {
    if (words.has(word)) return true;
  }
  return false;
}

function eventLabel(summary: string, draft: string): string {
  const source = summary.trim() || draft.trim();
  const cleaned = source
    .replace(/^you['’]?d like to (add|move|change|schedule)\s+/i, "")
    .replace(/\s+to your calendar\.?$/i, "")
    .replace(/\.$/, "")
    .trim();
  return cleaned || "that event";
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

function formatClock(iso: string, timezone: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    hour: "numeric",
    minute: "2-digit",
  }).format(date);
}

function formatMinutes(total: number): string {
  const hour24 = Math.floor(total / 60) % 24;
  const minute = total % 60;
  const meridiem = hour24 >= 12 ? "PM" : "AM";
  const hour12 = hour24 % 12 || 12;
  return `${hour12}:${String(minute).padStart(2, "0")} ${meridiem}`;
}

function ask(draft: string): Proposal {
  return {
    type: "ask_clarification",
    draft,
    depends_on: null,
    requires_approval: true,
  };
}

async function loadCandidates(input: CalendarMatchInput): Promise<CalendarRow[] | null> {
  const ymd = parseIso(input.iso);
  if (!ymd) return [];
  const start = zonedTimeToUtc(addDays(ymd, -1), 0, 0, 0, input.timezone);
  const end = zonedTimeToUtc(addDays(ymd, 1), 23, 59, 59, input.timezone);
  const admin = getServiceRoleClient();
  const { data, error } = await admin
    .from("calendar_events")
    .select("id, title, child_id, start_time, status")
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
  const label = eventLabel(input.summary, proposal.draft);
  const when = formatDateLabel(input.iso, input.timezone);
  if (rows == null) {
    return ask(
      `I couldn't check the calendar for ${label} on ${when}. Want to tell me which event you mean?`
    );
  }
  const proposed = significantWords(`${input.summary} ${proposal.draft} ${input.corpus}`);
  const hits = rows.filter((row) => sharesDistinctiveWord(proposed, row.title ?? ""));
  const newMinutes = parseClockMinutes(input.corpus);
  const newClock = newMinutes != null ? formatMinutes(newMinutes) : null;

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
    const oldClock = formatClock(hit.start_time, input.timezone);
    const title = (hit.title ?? label).trim() || label;
    const draft =
      oldClock && newClock
        ? `Move ${title} from ${oldClock} to ${newClock}.`
        : oldClock
          ? `Update ${title} on ${when}. It is currently at ${oldClock}.`
          : `Update ${title} on ${when}.`;
    return {
      ...proposal,
      type: "calendar_update",
      draft,
      date: input.iso,
      calendar_intent: "update",
      calendar_event_id: hit.id,
    };
  }

  const offerWhen = newClock ? `${when} at ${newClock}` : when;
  return {
    ...proposal,
    type: "calendar_update",
    draft: `Nothing on your calendar for ${label} on ${offerWhen}. Want me to add it?`,
    date: input.iso,
    calendar_intent: "offer",
    calendar_event_id: null,
  };
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
