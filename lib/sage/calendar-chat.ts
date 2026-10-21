import type { getServiceRoleClient } from "@/lib/supabase/server";
import { resolveDate } from "@/lib/sage/resolver";

type Admin = ReturnType<typeof getServiceRoleClient>;

export type KnownChild = {
  id: string;
  name: string;
};

export type CaseEvent = {
  id: string;
  title: string;
  childId: string | null;
  /** ISO timestamp. */
  start: string;
  description: string | null;
  status: string | null;
  allDay: boolean;
  visibility: string | null;
  createdBy: string | null;
};

const SUBJECTS: Array<{ subject: string; category: string; pattern: RegExp }> = [
  { subject: "Orthodontist Appointment", category: "medical", pattern: /\borthodont/i },
  { subject: "Dentist Appointment", category: "medical", pattern: /\b(dentist|dental)\b/i },
  { subject: "Doctor Appointment", category: "medical", pattern: /\b(doctor|pediatric|physician)\b/i },
  { subject: "Therapy Appointment", category: "therapy", pattern: /\btherapy\b/i },
  { subject: "OT Appointment", category: "therapy", pattern: /\b(ot|occupational therapy)\b/i },
  { subject: "School", category: "school", pattern: /\bschool\b/i },
  { subject: "Pickup", category: "custody_exchange", pattern: /\b(pickup|pick-up|pick up)\b/i },
  { subject: "Drop-off", category: "custody_exchange", pattern: /\b(drop-?off|drop off)\b/i },
  { subject: "Practice", category: "extracurricular", pattern: /\bpractice\b/i },
  { subject: "Recital", category: "extracurricular", pattern: /\brecital\b/i },
  { subject: "Appointment", category: "other", pattern: /\bappointment\b/i },
];

export function appointmentSubject(text: string): { subject: string; category: string } | null {
  for (const entry of SUBJECTS) {
    if (entry.pattern.test(text)) return { subject: entry.subject, category: entry.category };
  }
  return null;
}

export function matchChildren(text: string, children: KnownChild[]): KnownChild[] {
  const hits: KnownChild[] = [];
  for (const child of children) {
    const first = child.name.trim().split(/\s+/)[0];
    if (!first || first.length < 2) continue;
    const pattern = new RegExp(`\\b${first.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i");
    if (pattern.test(text)) hits.push(child);
  }
  return hits;
}

export function clockWithMeridiem(text: string): string | null {
  const spoken = text.match(/\b(\d{1,2})(?::(\d{2}))?\s*(a\.?m\.?|p\.?m\.?)\b/i);
  if (spoken) {
    let hour = Number(spoken[1]);
    const minute = spoken[2] != null ? Number(spoken[2]) : 0;
    const meridiem = spoken[3].toLowerCase();
    if (hour < 1 || hour > 12 || minute > 59) return null;
    if (meridiem.startsWith("p") && hour < 12) hour += 12;
    if (meridiem.startsWith("a") && hour === 12) hour = 0;
    return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
  }
  const hhmm = text.match(/\b([01]?\d|2[0-3]):([0-5]\d)\b/);
  if (!hhmm) return null;
  return `${String(Number(hhmm[1])).padStart(2, "0")}:${hhmm[2]}`;
}

export function wantsAllDay(text: string): boolean {
  return /\ball[\s-]?day\b/i.test(text);
}

export function isCalendarQuestion(text: string): boolean {
  const lower = text.toLowerCase();
  if (/\b(add|create|book|put|log|schedule)\b/.test(lower) && !/\bscheduled\b/.test(lower)) {
    return false;
  }
  const asks =
    /\b(what|when|show|list|do we have|coming up|upcoming)\b/.test(lower) ||
    /\?/.test(text);
  const about = /\b(appointment|appointments|calendar|scheduled)\b/.test(lower);
  return asks && about;
}

export function locationPhrase(text: string): string | null {
  const change = text.match(/\b(?:change|move) the location to\s+(.+?)(?:\.|$)/i);
  if (change?.[1]) return cleanPlace(change[1]);
  const its = text.match(/\bit(?:['’]s| is)\s+at\s+([^,.]+)/i);
  if (its?.[1]) return cleanPlace(its[1]);
  return null;
}

function cleanPlace(value: string): string | null {
  const place = value.replace(/^(?:the|a|an)\s+/i, "").trim();
  if (!place || /^\d/.test(place)) return null;
  return place.replace(/\s+/g, " ").slice(0, 80);
}

export function earlyArrivalNote(text: string): string | null {
  const match = text.match(/\barrive\s+(\d+)\s+minutes?\s+early\b/i);
  if (!match) return null;
  return `Arrive ${match[1]} minutes early.`;
}

export function isCancelRequest(text: string): boolean {
  return /\b(cancel(?:l?ed|led)?|called off)\b/i.test(text);
}

export function isEventDetailUpdate(text: string): boolean {
  if (isCancelRequest(text)) return true;
  if (locationPhrase(text) || earlyArrivalNote(text)) return true;
  if (clockWithMeridiem(text) && /\b(actually|change|make that|move|it(?:['’]s| is) at)\b/i.test(text)) {
    return true;
  }
  return false;
}

export function composeEventDescription(input: {
  existing: string | null;
  location: string | null;
  note: string | null;
}): string {
  const existing = input.existing ?? "";
  const keptArrive = existing.match(/\bArrive\s+\d+\s+minutes?\s+early\.?/i)?.[0] ?? null;
  const keptLocation = existing.match(/^Location:\s*(.+)$/im)?.[1]?.trim() || null;
  const kept = existing
    .replace(/^Location:\s*.+$/gim, "")
    .replace(/\bArrive\s+\d+\s+minutes?\s+early\.?/gi, "")
    .replace(/\n{2,}/g, "\n")
    .trim();
  const note =
    input.note ??
    (keptArrive ? (keptArrive.endsWith(".") ? keptArrive : `${keptArrive}.`) : null);
  const location = input.location ?? keptLocation;
  const lines = [
    kept || null,
    location ? `Location: ${location}` : null,
    note,
  ].filter((line): line is string => Boolean(line && line.trim()));
  return lines.join("\n");
}

export function locationFromDescription(description: string | null | undefined): string | null {
  const match = description?.match(/^Location:\s*(.+)$/im);
  return match?.[1]?.trim() || null;
}

export function eventVisibleToParent(
  event: { visibility: string | null; createdBy: string | null; description?: string | null },
  viewerId: string
): boolean {
  const visibility = (event.visibility ?? "").trim().toLowerCase();
  const legacyPrivate = !visibility && (event.description?.startsWith("[PRIVATE]") ?? false);
  if (visibility === "private" || visibility === "just_me_and_kids" || legacyPrivate) {
    return event.createdBy === viewerId;
  }
  return true;
}

export function isCanceledStatus(status: string | null | undefined): boolean {
  const value = (status ?? "").toLowerCase();
  return value === "canceled" || value === "cancelled";
}

function ymdInZone(iso: string, timezone: string): string | null {
  const dt = new Date(iso);
  if (Number.isNaN(dt.getTime())) return null;
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(dt);
  const year = parts.find((part) => part.type === "year")?.value;
  const month = parts.find((part) => part.type === "month")?.value;
  const day = parts.find((part) => part.type === "day")?.value;
  return year && month && day ? `${year}-${month}-${day}` : null;
}

function formatWhen(iso: string, timezone: string, allDay: boolean): string {
  const dt = new Date(iso);
  const date = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    weekday: "short",
    month: "short",
    day: "numeric",
  }).format(dt);
  if (allDay) return `${date}, all day`;
  const time = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    hour: "numeric",
    minute: "2-digit",
  }).format(dt);
  return `${date}, ${time}`;
}

export function answerCalendarQuestion(input: {
  message: string;
  children: KnownChild[];
  events: CaseEvent[];
  viewerId: string;
  today: Date;
  timezone: string;
}): string | null {
  if (!isCalendarQuestion(input.message)) return null;
  const named = matchChildren(input.message, input.children);
  if (named.length > 1) {
    const list = [...new Set(named.map((child) => child.name))].join(" and ");
    return `Which ${list} do you mean?`;
  }
  const child = named[0] ?? null;
  const includeCanceled = /\bcancel(?:l?ed|led)\b/i.test(input.message);
  const nextOnly = /\bnext\b/i.test(input.message);
  const month = /\bthis month\b/i.test(input.message);
  const datePhrase = input.message.match(
    /\b(tomorrow|today|tonight|monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/i
  );
  const resolved = datePhrase
    ? resolveDate(datePhrase[1], input.today, input.timezone, input.message)
    : null;
  const day = resolved?.status === "resolved" ? resolved.iso : null;
  const todayKey = ymdInZone(input.today.toISOString(), input.timezone);
  const monthKey = todayKey?.slice(0, 7) ?? null;

  const rows = input.events
    .filter((event) => eventVisibleToParent(event, input.viewerId))
    .filter((event) => (includeCanceled ? true : !isCanceledStatus(event.status)))
    .filter((event) => (child ? event.childId === child.id : true))
    .filter((event) => {
      const key = ymdInZone(event.start, input.timezone);
      if (!key || !todayKey) return false;
      if (day) return key === day;
      if (month && monthKey) return key.slice(0, 7) === monthKey && key >= todayKey;
      return key >= todayKey;
    })
    .sort((a, b) => new Date(a.start).getTime() - new Date(b.start).getTime());

  const shown = nextOnly ? rows.slice(0, 1) : rows;
  const who = child?.name ?? "the calendar";
  if (shown.length === 0) {
    return child
      ? `${child.name} doesn't have a matching appointment.`
      : "Nothing on the calendar matches that.";
  }
  const lines = shown.map((event) => {
    const when = formatWhen(event.start, input.timezone, event.allDay);
    const place = locationFromDescription(event.description);
    return `- ${when} — ${event.title}${place ? ` — ${place}` : ""}`;
  });
  const heading = nextOnly
    ? `${who === "the calendar" ? "The next appointment" : `${child?.name}'s next appointment`}:`
    : child
      ? `${child.name} has ${shown.length === 1 ? "this appointment" : "these appointments"}:`
      : `Here is what is on the calendar:`;
  return [heading, ...lines].join("\n");
}

/** Saved events a follow-up can edit. A stored event id is handled by the caller. */
export function followUpTargets(input: {
  events: CaseEvent[];
  childId: string | null;
  date: string | null;
  subject: string | null;
  timezone: string;
}): CaseEvent[] {
  const words = (input.subject ?? "")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((word) => word.length > 2 && word !== "appointment");
  return input.events.filter((event) => {
    if (isCanceledStatus(event.status)) return false;
    if (input.childId && event.childId && event.childId !== input.childId) return false;
    if (input.date) {
      const key = ymdInZone(event.start, input.timezone);
      if (key !== input.date) return false;
    }
    if (words.length === 0) return true;
    const title = event.title.toLowerCase();
    return words.some((word) => title.includes(word));
  });
}

export function savedEventPointer(proposals: unknown[]): { id: string; time: string | null } | null {
  for (let index = proposals.length - 1; index >= 0; index -= 1) {
    const raw = proposals[index];
    if (!raw || typeof raw !== "object") continue;
    const proposal = raw as {
      type?: string;
      result_event_id?: string;
      calendar_event_id?: string;
      event_start?: string | null;
      executed?: boolean;
    };
    if (proposal.type !== "calendar_update") continue;
    const id = (proposal.result_event_id || proposal.calendar_event_id || "").trim();
    if (!id || proposal.executed !== true && !proposal.result_event_id) continue;
    const time =
      typeof proposal.event_start === "string" && /^\d{2}:\d{2}$/.test(proposal.event_start)
        ? proposal.event_start
        : null;
    return { id, time };
  }
  return null;
}

export async function loadCalendarContext(
  admin: Admin,
  caseId: string,
  viewerId: string
): Promise<{ children: KnownChild[]; events: CaseEvent[] }> {
  const { data: childRows } = await admin
    .from("children")
    .select("id, first_name")
    .eq("case_id", caseId)
    .is("deleted_at", null);
  const children = ((childRows ?? []) as { id?: string; first_name?: string }[])
    .filter((row) => row.id && row.first_name?.trim())
    .map((row) => ({ id: row.id as string, name: (row.first_name as string).trim() }));

  const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
  const { data: eventRows, error } = await admin
    .from("calendar_events")
    .select("id, title, description, child_id, start_time, all_day, status, visibility, created_by")
    .eq("case_id", caseId)
    .is("deleted_at", null)
    .gte("start_time", since)
    .order("start_time", { ascending: true })
    .limit(80);
  if (error) {
    console.error("[sage/calendar-chat] events", error.message);
    return { children, events: [] };
  }
  const events = ((eventRows ?? []) as {
    id: string;
    title?: string | null;
    description?: string | null;
    child_id?: string | null;
    start_time?: string | null;
    all_day?: boolean | null;
    status?: string | null;
    visibility?: string | null;
    created_by?: string | null;
  }[])
    .filter((row) => row.start_time)
    .map((row) => ({
      id: row.id,
      title: (row.title ?? "").trim() || "Appointment",
      childId: row.child_id ?? null,
      start: row.start_time as string,
      description: row.description ?? null,
      status: row.status ?? null,
      allDay: row.all_day === true,
      visibility: row.visibility ?? null,
      createdBy: row.created_by ?? null,
    }))
    .filter((event) => eventVisibleToParent(event, viewerId));
  return { children, events };
}
