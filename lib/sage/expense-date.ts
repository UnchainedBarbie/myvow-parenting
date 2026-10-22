import type { Proposal } from "@/lib/sage/planner";
import { resolveDate } from "@/lib/sage/resolver";

const RELATIVE = "today|tonight|yesterday|tomorrow";
const WEEKDAY = "monday|tuesday|wednesday|thursday|friday|saturday|sunday";
const MONTH =
  "jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?";

const DATE_TOKEN = new RegExp(
  `\\b(?:(?:next|this)\\s+)?(?:${RELATIVE}|${WEEKDAY}|(?:${MONTH})\\.?\\s+\\d{1,2}(?:st|nd|rd|th)?(?:,?\\s+\\d{4})?|\\d{1,2}[\\/\\-]\\d{1,2}(?:[\\/\\-]\\d{2,4})?)\\b`,
  "gi"
);

const ACTIVITY =
  /\b(field trips?|appointments?|practices?|games?|recitals?|classes?|therap(?:y|ies)|dentists?|doctors?|school)\b/gi;

const PAYMENT = /\b(paid|pay|spent|spend|spending|bought|buy|incurred|charged|payment)\b/i;

const WEEKDAY_INDEX: Record<string, number> = {
  sunday: 0,
  monday: 1,
  tuesday: 2,
  wednesday: 3,
  thursday: 4,
  friday: 5,
  saturday: 6,
};

export type ExpenseIncurredDate = {
  iso: string;
  /** True when the parent said when they paid or incurred it. */
  stated: boolean;
};

/**
 * The date an expense was paid or incurred.
 * An activity date ("field trip on Friday") is not the incurred date.
 * When the parent does not name a payment date, the incurred date is today.
 */
export function resolveExpenseIncurredDate(
  text: string,
  today: Date,
  timezone: string
): ExpenseIncurredDate {
  const fallback = isoToday(today, timezone);
  const hits = dateHits(text);
  const stated = hits.find((hit) => hit.payment) ?? hits.find((hit) => hit.relative && !hit.activity);
  if (!stated) return { iso: fallback, stated: false };
  const iso = toIncurredIso(stated.raw, today, timezone);
  if (!iso) return { iso: fallback, stated: false };
  return { iso, stated: true };
}

/** Put the incurred date on an expense proposal. Does not replace a date already chosen. */
export function stampExpenseIncurredDate<T extends { type: string; date?: string | null }>(
  proposal: T,
  text: string,
  today: Date,
  timezone: string
): T {
  if (proposal.type !== "log_expense") return proposal;
  const existing = typeof proposal.date === "string" ? proposal.date.trim() : "";
  if (/^\d{4}-\d{2}-\d{2}$/.test(existing)) return proposal;
  return { ...proposal, date: resolveExpenseIncurredDate(text, today, timezone).iso };
}

/**
 * A completed expense does not wait on the date of the activity.
 * Drops a date question when an expense proposal is already present, and
 * fills a missing incurred date.
 */
export function finalizeExpenseProposals(
  proposals: Proposal[],
  text: string,
  today: Date,
  timezone: string
): Proposal[] {
  const hasExpense = proposals.some((proposal) => proposal.type === "log_expense");
  if (!hasExpense) return proposals;
  return proposals.flatMap((proposal) => {
    if (proposal.type === "ask_clarification" && isExpenseDateQuestion(proposal.draft)) {
      return [];
    }
    if (proposal.type !== "log_expense") return [proposal];
    const stamped = stampExpenseIncurredDate(proposal, text, today, timezone);
    const depends = (stamped.depends_on ?? "").trim();
    if (depends && /date/i.test(depends) && !/child/i.test(depends)) {
      return [{ ...stamped, depends_on: null }];
    }
    return [stamped];
  });
}

export function isExpenseDateQuestion(draft: string | null | undefined): boolean {
  const text = (draft ?? "").trim();
  if (!text) return false;
  return (
    /\b(which|what) date\b/i.test(text) ||
    /\bconfirm which exact date\b/i.test(text) ||
    /\bwhen (?:is|was) (?:the |that )?(?:field trip|appointment|event|practice|game)\b/i.test(text)
  );
}

function dateHits(text: string): { raw: string; payment: boolean; activity: boolean; relative: boolean }[] {
  const hits = [];
  for (const match of text.matchAll(DATE_TOKEN)) {
    const raw = match[0];
    const index = match.index ?? 0;
    const before = text.slice(Math.max(0, index - 48), index);
    const activity = activityOwnsDate(before);
    hits.push({
      raw,
      activity,
      payment: !activity && paymentAnchored(text, index, raw.length),
      relative: /^(?:today|tonight|yesterday|tomorrow)\b/i.test(raw.trim()),
    });
  }
  return hits;
}

function activityOwnsDate(before: string): boolean {
  ACTIVITY.lastIndex = 0;
  const matches = [...before.matchAll(ACTIVITY)];
  if (matches.length === 0) return false;
  const last = matches[matches.length - 1];
  const at = last.index ?? 0;
  const between = before.slice(at + last[0].length);
  if (PAYMENT.test(between)) return false;
  return between.length <= 28;
}

function paymentAnchored(text: string, index: number, length: number): boolean {
  const before = text.slice(Math.max(0, index - 48), index);
  const after = text.slice(index + length, index + length + 36);
  if (PAYMENT.test(before)) return true;
  return /^\s*(?:i|we)\s+(?:paid|spent|bought|incurred)\b/i.test(after);
}

function toIncurredIso(raw: string, today: Date, timezone: string): string | null {
  const trimmed = raw.trim();
  if (/^(?:next|this)\b/i.test(trimmed) || /^(?:today|tonight|yesterday|tomorrow)\b/i.test(trimmed)) {
    const resolved = resolveDate(trimmed, today, timezone, trimmed);
    return resolved.status === "resolved" ? resolved.iso : null;
  }
  const cleaned = trimmed.replace(/^on\s+/i, "");
  const weekday = cleaned.toLowerCase();
  if (WEEKDAY_INDEX[weekday] != null) {
    return recentWeekdayOnOrBefore(weekday, today, timezone);
  }
  const resolved = resolveDate(cleaned, today, timezone, cleaned);
  return resolved.status === "resolved" ? resolved.iso : null;
}

function recentWeekdayOnOrBefore(weekday: string, today: Date, timezone: string): string | null {
  const target = WEEKDAY_INDEX[weekday];
  if (target == null) return null;
  const iso = isoToday(today, timezone);
  const current = new Date(`${iso}T12:00:00Z`).getUTCDay();
  const back = (current - target + 7) % 7;
  const dt = new Date(`${iso}T12:00:00Z`);
  dt.setUTCDate(dt.getUTCDate() - back);
  return dt.toISOString().slice(0, 10);
}

function isoToday(today: Date, timezone: string): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(today);
  const year = parts.find((part) => part.type === "year")?.value ?? "0000";
  const month = parts.find((part) => part.type === "month")?.value ?? "01";
  const day = parts.find((part) => part.type === "day")?.value ?? "01";
  return `${year}-${month}-${day}`;
}
