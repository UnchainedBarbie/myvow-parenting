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

type TimeRole = "start" | "arrival" | "pickup" | "other";

type PlacedTime = Fact & { role: TimeRole };

const NEVER_IN_VOICE = [
  { re: /\bactually\b/i, label: "actually" },
  { re: /just a heads-up/i, label: "just a heads-up" },
  { re: /just so you know/i, label: "just so you know" },
  { re: /\bfyi\b/i, label: "FYI" },
];

const WARMTH_UNLESS_ASKED = [
  { re: /hope that helps/i, label: "hope that helps" },
  { re: /let me know if you need/i, label: "let me know if you need anything" },
];

/** Exclamation points and managing phrases. Warmth is allowed only when the user asked for that phrase. */
export function voiceProblems(draft: string, userAsked: string): string[] {
  const problems: string[] = [];
  if (draft.includes("!")) problems.push("exclamation point");
  for (const item of NEVER_IN_VOICE) {
    if (item.re.test(draft)) problems.push(item.label);
  }
  for (const item of WARMTH_UNLESS_ASKED) {
    if (item.re.test(draft) && !item.re.test(userAsked)) problems.push(item.label);
  }
  return problems;
}

function timeRole(text: string, index: number): TimeRole {
  const slice = text.slice(Math.max(0, index - 48), index);
  const clause = slice.split(/[,;.]/).pop() ?? slice;
  const before = clause.toLowerCase();
  if (/\bpick(?:\s+\w+){0,3}\s+up\b|\bpick\s?up\b|\bdrop-?\s?off\b|\bdropoff\b/.test(before)) return "pickup";
  if (/arriv|be there|there by|needs to be/.test(before)) return "arrival";
  if (/start|begin|it'?s at|it is at|is at/.test(before)) return "start";
  return "other";
}

function placedTimes(text: string): PlacedTime[] {
  const facts: PlacedTime[] = [];
  const seen = new Set<string>();
  const pattern =
    /\b(\d{1,2})(?::(\d{2}))?\s*(a\.?m\.?|p\.?m\.?)?\b|\b([01]?\d|2[0-3]):([0-5]\d)\b/gi;
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
      hour = Number(match[1]);
      minute = match[2] != null ? Number(match[2]) : 0;
      if (!Number.isFinite(hour) || minute > 59 || hour < 1 || hour > 12) continue;
      const bareRole = timeRole(text, match.index ?? 0);
      if ((bareRole === "arrival" || bareRole === "pickup") && hour <= 8) {
        hour += 12;
      } else {
        continue;
      }
    }
    const role = timeRole(text, match.index ?? 0);
    const minuteKey = hour * 60 + minute;
    const seenKey = `${role}:${minuteKey}`;
    if (seen.has(seenKey)) continue;
    seen.add(seenKey);
    const key = `time:${minuteKey}`;
    const hour12 = hour % 12 || 12;
    const label = `${hour12}:${String(minute).padStart(2, "0")} ${hour >= 12 ? "PM" : "AM"}`;
    facts.push({
      key,
      label,
      role,
    });
  }
  return facts;
}

function compactClock(key: string): string {
  const minutes = Number(key.slice("time:".length));
  const hour24 = Math.floor(minutes / 60) % 24;
  const minute = minutes % 60;
  const hour12 = hour24 % 12 || 12;
  const suffix = hour24 >= 12 ? "pm" : "am";
  if (minute === 0) return `${hour12}${suffix}`;
  return `${hour12}:${String(minute).padStart(2, "0")}${suffix}`;
}

function hhmmFromKey(key: string): string {
  const minutes = Number(key.slice("time:".length));
  const hour24 = Math.floor(minutes / 60) % 24;
  const minute = minutes % 60;
  return `${String(hour24).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

/** Clocks in a text, with start vs arrival taken from the words beside each one. */
export function scheduleClocks(text: string): { role: TimeRole; hhmm: string }[] {
  return placedTimes(text).map((time) => ({ role: time.role, hhmm: hhmmFromKey(time.key) }));
}

export type ScheduleParts = {
  /** When the event begins, HH:mm. Arrival and pickup are never placed here. */
  start: string | null;
  /** Arrival or "needs to be there by", HH:mm. */
  arrival: string | null;
  /** Pickup or drop-off, HH:mm. Not an event end. */
  pickup: string | null;
};

/** Last start, last arrival, and last pickup. A later clock replaces an earlier one of the same role. */
export function splitSchedule(text: string): ScheduleParts {
  let start: string | null = null;
  let arrival: string | null = null;
  let pickup: string | null = null;
  for (const clock of scheduleClocks(text)) {
    if (clock.role === "arrival") arrival = clock.hhmm;
    else if (clock.role === "pickup") pickup = clock.hhmm;
    else start = clock.hhmm;
  }
  return { start, arrival, pickup };
}

function retractedTimeKeys(guidance: string, known: PlacedTime[]): Set<string> {
  const keys = new Set<string>();
  const pattern =
    /\b(?:not|instead of|rather than|no longer(?:\s+at)?)\s+(\d{1,2}(?::\d{2})?(?:\s*(?:a\.?m\.?|p\.?m\.?))?)/gi;
  for (const match of guidance.matchAll(pattern)) {
    const token = match[1].trim();
    const parsed = placedTimes(token);
    if (parsed.length > 0) {
      for (const time of parsed) keys.add(time.key);
      continue;
    }
    const hour = Number(token);
    if (!Number.isFinite(hour)) continue;
    for (const time of known) {
      const minutes = Number(time.key.slice("time:".length));
      const hour24 = Math.floor(minutes / 60) % 24;
      const hour12 = hour24 % 12 || 12;
      if (hour === hour12 || hour === hour24) keys.add(time.key);
    }
  }
  return keys;
}

function retractedDateKeys(guidance: string): Set<string> {
  const slice = guidance.match(
    /\b(?:not|instead of|rather than|no longer(?:\s+on)?)\s+([^.,]+)/i
  );
  if (!slice) return new Set();
  return new Set(dateFacts(slice[1]).map((fact) => fact.key));
}

function retractedAmountKeys(guidance: string): Set<string> {
  const keys = new Set<string>();
  const pattern = /\b(?:not|instead of|rather than|no longer)\s+(\$\s*\d[\d,]*(?:\.\d{1,2})?)/gi;
  for (const match of guidance.matchAll(pattern)) {
    for (const fact of amountFacts(match[1])) keys.add(fact.key);
  }
  return keys;
}

function replacesStart(guidance: string, added: PlacedTime[]): boolean {
  const addsStart = added.some((time) => time.role === "start" || time.role === "other");
  if (!addsStart) return false;
  return /\b(?:actually|instead|rather|change|switch|make it)\b/i.test(guidance);
}

export type MergedFacts = {
  times: PlacedTime[];
  dates: Fact[];
  amounts: Fact[];
};

/**
 * Facts from the current draft, plus facts the new turn adds.
 * A time, date, or amount drops only when the new turn corrects or retracts it.
 * An arrival time does not replace a start time.
 */
export function mergeFacts(previous: string, guidance: string): MergedFacts {
  const priorTimes = placedTimes(previous);
  const addedTimes = placedTimes(guidance);
  const dropTimes = retractedTimeKeys(guidance, priorTimes);
  const keptTimes = priorTimes.filter((time) => !dropTimes.has(time.key));
  const incoming = addedTimes.filter((time) => !dropTimes.has(time.key));
  let times = keptTimes;
  if (replacesStart(guidance, incoming)) {
    times = times.filter((time) => time.role === "arrival");
  }
  for (const time of incoming) {
    if (!times.some((kept) => kept.key === time.key)) times.push(time);
  }

  const dropDates = retractedDateKeys(guidance);
  const dates = [...dateFacts(previous), ...dateFacts(guidance)].filter(
    (fact, index, all) =>
      !dropDates.has(fact.key) && all.findIndex((item) => item.key === fact.key) === index
  );
  const dropAmounts = retractedAmountKeys(guidance);
  const amounts = [...amountFacts(previous), ...amountFacts(guidance)].filter(
    (fact, index, all) =>
      !dropAmounts.has(fact.key) && all.findIndex((item) => item.key === fact.key) === index
  );
  return { times, dates, amounts };
}

/** Labels of facts the revision dropped even though the user did not retract them. */
export function droppedFactLabels(next: string, previous: string, guidance: string): string[] {
  const kept = mergeFacts(previous, guidance);
  const present = new Set([
    ...timeFacts(next).map((fact) => fact.key),
    ...dateFacts(next).map((fact) => fact.key),
    ...amountFacts(next).map((fact) => fact.key),
  ]);
  const missing: string[] = [];
  for (const time of kept.times) {
    if (!present.has(time.key)) missing.push(time.label);
  }
  const weekdayKept = kept.dates.some(
    (fact) => fact.key.startsWith("dow:") && present.has(fact.key)
  );
  for (const date of kept.dates) {
    if (present.has(date.key)) continue;
    if (weekdayKept && !date.key.startsWith("dow:")) continue;
    missing.push(date.label);
  }
  for (const amount of kept.amounts) {
    if (!present.has(amount.key)) missing.push(amount.label);
  }
  return missing;
}

function personName(child: string | null | undefined, text: string): string {
  const named = child?.trim();
  if (named) return named;
  if (/\bshe\b/i.test(text)) return "She";
  if (/\bhe\b/i.test(text)) return "He";
  return "They";
}

/** Plain sentences for the facts that should remain after a revision. */
export function composeFactualReply(input: {
  currentDraft: string;
  guidance: string;
  event?: string | null;
  child?: string | null;
}): string {
  const kept = mergeFacts(input.currentDraft, input.guidance);
  const event = (
    input.event?.trim() ||
    eventSubjectFromTexts([input.currentDraft, input.guidance]) ||
    "event"
  ).toLowerCase();
  const date =
    kept.dates.find((fact) => fact.key.startsWith("dow:"))?.label ??
    kept.dates.find((fact) => fact.key.startsWith("md:") && !/^\d{4}-/.test(fact.label))?.label ??
    null;
  const start =
    kept.times.find((time) => time.role === "start") ??
    kept.times.find((time) => time.role === "other") ??
    null;
  const arrivals = kept.times.filter((time) => time.role === "arrival");
  const sentences: string[] = [];
  if (start) {
    const when = date ? ` on ${date}` : "";
    sentences.push(`The ${event} is at ${compactClock(start.key)}${when}.`);
  }
  const who = personName(input.child, `${input.currentDraft}\n${input.guidance}`);
  for (const arrival of arrivals) {
    sentences.push(`${who} needs to be there by ${compactClock(arrival.key)}.`);
  }
  if (!start && date && arrivals.length === 0) {
    sentences.push(`The ${event} is on ${date}.`);
  }
  for (const amount of kept.amounts) {
    sentences.push(`The amount is ${amount.label}.`);
  }
  return sentences.join(" ");
}

/** Sentences stating the schedule facts to put on an open calendar proposal. */
export function scheduleSentences(
  previous: string,
  guidance: string,
  child?: string | null,
  event?: string | null
): string {
  return composeFactualReply({
    currentDraft: previous,
    guidance,
    child,
    event,
  });
}

/** Start time introduced by this turn, for a calendar move. An arrival time is not a new start. */
export function replacementStartLabel(text: string): string | null {
  const starts = placedTimes(text).filter((time) => time.role === "start");
  return starts.length > 0 ? starts[starts.length - 1].label : null;
}
