/**
 * Correctness gate for text the parent will send to the co-parent.
 * A time, date, or amount in that sentence must already be in the sources.
 */

import { eventSubjectFromTexts } from "@/lib/sage/event-subject";

export const NO_DETAIL_REPLY = "I'll confirm and follow up.";

export type DetailKind = "time" | "date" | "place" | "amount";

export type DetailQuestion = {
  kind: DetailKind;
  subject: string | null;
  when: string | null;
  question: string;
};

const WEEKDAYS = [
  "sunday",
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
] as const;

const MONTHS: { name: string; num: number }[] = [
  { name: "january", num: 1 },
  { name: "jan", num: 1 },
  { name: "february", num: 2 },
  { name: "feb", num: 2 },
  { name: "march", num: 3 },
  { name: "mar", num: 3 },
  { name: "april", num: 4 },
  { name: "apr", num: 4 },
  { name: "may", num: 5 },
  { name: "june", num: 6 },
  { name: "jun", num: 6 },
  { name: "july", num: 7 },
  { name: "jul", num: 7 },
  { name: "august", num: 8 },
  { name: "aug", num: 8 },
  { name: "september", num: 9 },
  { name: "sep", num: 9 },
  { name: "sept", num: 9 },
  { name: "october", num: 10 },
  { name: "oct", num: 10 },
  { name: "november", num: 11 },
  { name: "nov", num: 11 },
  { name: "december", num: 12 },
  { name: "dec", num: 12 },
];

const CLAIM =
  /\b(?:just checked|(?:i|we)(?:'ve| have)? checked|(?:i|we) confirmed|(?:i|we)(?:'ve| have) confirmed|looked up|(?:i|we) verified|(?:i|we) spoke|(?:i|we) called|(?:i|we) asked)\b/i;

function titleDay(day: string): string {
  const lower = day.toLowerCase();
  return lower.charAt(0).toUpperCase() + lower.slice(1);
}

function weekdayPhrase(text: string): string | null {
  const match = text.match(
    /\b(?:this |next )?(sunday|monday|tuesday|wednesday|thursday|friday|saturday)\b/i
  );
  return match ? titleDay(match[1]) : null;
}

function questionFor(kind: DetailKind, subject: string | null, when: string | null): string {
  const event = subject ? subject.toLowerCase() : "event";
  const on = when ? ` on ${when}` : "";
  if (kind === "time") return `What time is the ${event}${on}?`;
  if (kind === "date") return `What date is the ${event}?`;
  if (kind === "place") return `Where is the ${event}${on}?`;
  return `How much is the ${event}?`;
}

/** A co-parent question that asks for a time, date, place, or amount. */
export function detectDetailQuestion(text: string): DetailQuestion | null {
  const raw = text.trim();
  if (!raw) return null;
  const lower = raw.toLowerCase();
  const asks = /\?|\b(?:what|when|where|which|how much)\b/.test(lower);
  if (!asks) return null;

  let kind: DetailKind | null = null;
  if (/\bwhat time\b|\bstart time\b|\bwhen does\b[^.?]{0,40}\bstart\b/.test(lower)) {
    kind = "time";
  } else if (/\bwhat day\b|\bwhich day\b|\bwhat date\b|\bwhen is\b|\bwhen does\b/.test(lower)) {
    kind = "date";
  } else if (/\bwhere is\b|\bwhere'?s\b|\bwhat address\b|\bwhich location\b/.test(lower)) {
    kind = "place";
  } else if (/\bhow much\b|\bwhat(?:'s| is) the (?:cost|amount|price|total)\b/.test(lower)) {
    kind = "amount";
  }
  if (!kind) return null;

  const subject = eventSubjectFromTexts([raw]);
  const when = weekdayPhrase(raw);
  return { kind, subject, when, question: questionFor(kind, subject, when) };
}

type Fact = { key: string; label: string };

function timeFacts(text: string): Fact[] {
  const facts: Fact[] = [];
  const seen = new Set<string>();
  const pattern =
    /\b(\d{1,2})(?::(\d{2}))?\s*(a\.?m\.?|p\.?m\.?)\b|\b([01]?\d|2[0-3]):([0-5]\d)\b/gi;
  for (const match of text.matchAll(pattern)) {
    const meridiem = (match[3] ?? "").toLowerCase();
    const hasMeridiem = meridiem.startsWith("a") || meridiem.startsWith("p");
    let hour: number;
    let minute: number;
    if (hasMeridiem) {
      hour = Number(match[1]);
      minute = match[2] != null ? Number(match[2]) : 0;
      if (hour < 1 || hour > 12 || minute > 59) continue;
      if (meridiem.startsWith("p") && hour < 12) hour += 12;
      if (meridiem.startsWith("a") && hour === 12) hour = 0;
    } else if (match[4] != null) {
      hour = Number(match[4]);
      minute = Number(match[5]);
      if (hour > 23 || minute > 59) continue;
    } else {
      continue;
    }
    const key = `time:${hour * 60 + minute}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const hour12 = hour % 12 || 12;
    const label = `${hour12}:${String(minute).padStart(2, "0")} ${hour >= 12 ? "PM" : "AM"}`;
    facts.push({ key, label });
  }
  return facts;
}

function monthNumber(name: string): number | null {
  const hit = MONTHS.find((month) => month.name === name.toLowerCase());
  return hit ? hit.num : null;
}

function dateFacts(text: string): Fact[] {
  const facts: Fact[] = [];
  const seen = new Set<string>();
  const add = (key: string, label: string) => {
    if (seen.has(key)) return;
    seen.add(key);
    facts.push({ key, label });
  };
  const lower = text.toLowerCase();
  for (const day of WEEKDAYS) {
    if (new RegExp(`\\b${day}\\b`).test(lower)) add(`dow:${day}`, titleDay(day));
  }
  for (const match of text.matchAll(/\b(20\d{2})-(\d{2})-(\d{2})\b/g)) {
    const month = Number(match[2]);
    const day = Number(match[3]);
    if (month < 1 || month > 12 || day < 1 || day > 31) continue;
    add(`md:${month}-${day}`, `${match[1]}-${match[2]}-${match[3]}`);
  }
  const monthAlt = MONTHS.map((month) => month.name).join("|");
  const monthRe = new RegExp(
    `\\b(${monthAlt})\\.?\\s+(\\d{1,2})(?:st|nd|rd|th)?\\b`,
    "gi"
  );
  for (const match of text.matchAll(monthRe)) {
    const month = monthNumber(match[1]);
    const day = Number(match[2]);
    if (month == null || day < 1 || day > 31) continue;
    add(`md:${month}-${day}`, `${match[1]} ${day}`);
  }
  for (const match of text.matchAll(/\b(\d{1,2})\/(\d{1,2})(?:\/(20\d{2}))?\b/g)) {
    const month = Number(match[1]);
    const day = Number(match[2]);
    if (month < 1 || month > 12 || day < 1 || day > 31) continue;
    add(`md:${month}-${day}`, `${month}/${day}`);
  }
  return facts;
}

function moneyKey(raw: string): string | null {
  const value = Number(raw.replace(/,/g, ""));
  if (!Number.isFinite(value)) return null;
  return `amt:${value.toFixed(2)}`;
}

function amountFacts(text: string): Fact[] {
  const facts: Fact[] = [];
  const seen = new Set<string>();
  const add = (raw: string, label: string) => {
    const key = moneyKey(raw);
    if (!key || seen.has(key)) return;
    seen.add(key);
    facts.push({ key, label });
  };
  for (const match of text.matchAll(/\$\s*(\d{1,3}(?:,\d{3})*(?:\.\d{1,2})?)/g)) {
    add(match[1], `$${match[1]}`);
  }
  for (const match of text.matchAll(/\b(\d{1,3}(?:,\d{3})*(?:\.\d{1,2})?)\s+dollars?\b/gi)) {
    add(match[1], `${match[1]} dollars`);
  }
  return facts;
}

function normalizeSpaces(text: string): string {
  return text.replace(/[\u00a0\u202f\u2007\u2009]/g, " ");
}

function missingFrom(draftFacts: Fact[], sourceFacts: Fact[], kind: string): string[] {
  const allowed = new Set(sourceFacts.map((fact) => fact.key));
  return draftFacts
    .filter((fact) => !allowed.has(fact.key))
    .map((fact) => `${kind} ${fact.label}`);
}

/** The single time, date, or amount in the text, or null when there is not exactly one. */
export function soleFactLabel(text: string, kind: "time" | "date" | "amount"): string | null {
  const facts =
    kind === "time" ? timeFacts(text) : kind === "date" ? dateFacts(text) : amountFacts(text);
  return facts.length === 1 ? facts[0].label : null;
}

/**
 * Times, dates, dollar amounts, and "I checked" claims in the draft
 * that are not supported by the source text. Empty means the draft may be shown.
 */
export function unsupportedFacts(draft: string, sources: string): string[] {
  const draftText = normalizeSpaces(draft);
  const sourceText = normalizeSpaces(sources);
  const missing: string[] = [];
  const claim = draftText.match(CLAIM);
  if (claim) missing.push(`claim "${claim[0]}"`);
  missing.push(...missingFrom(timeFacts(draftText), timeFacts(sourceText), "time"));
  missing.push(...missingFrom(dateFacts(draftText), dateFacts(sourceText), "date"));
  missing.push(...missingFrom(amountFacts(draftText), amountFacts(sourceText), "amount"));
  return missing;
}
