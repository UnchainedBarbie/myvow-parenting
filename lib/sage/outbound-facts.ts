/**
 * Correctness gate for text the parent will send to the co-parent.
 * A time, date, amount, or legal obligation in that sentence must already be in the sources.
 */

import { eventSubjectFromTexts } from "@/lib/sage/event-subject";

export const NO_DETAIL_REPLY = "I'll confirm and follow up.";

/** Sage talking to the parent. These sentences are never a co-parent message. */
const PARENT_FACING = [
  "i don't yet have a draft",
  "i couldn't draft that",
  "that revision did not work",
  "i didn't understand that request",
  "what should the message say",
  "what should the message ask",
  "what should i tell",
  "i won't invent",
  "i will not invent",
  "i'll confirm and follow up",
  "who should i send that to",
  "i don't have a delivery email",
  "nothing is sent until you",
  "here is your message",
  "that doesn't give me a message",
  "i haven't drafted anything",
];

export function isParentFacingCopy(text: string): boolean {
  const norm = text
    .toLowerCase()
    .replace(/[^a-z0-9']+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!norm) return false;
  return PARENT_FACING.some((phrase) => norm.includes(phrase));
}

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

/** Record labels the parent already put in a draft: MSG-014, DOC-018, a quoted communication id. */
function recordFacts(text: string): Fact[] {
  const facts: Fact[] = [];
  const seen = new Set<string>();
  const add = (key: string, label: string) => {
    if (seen.has(key)) return;
    seen.add(key);
    facts.push({ key, label });
  };
  for (const match of text.matchAll(/\b((?:MSG|DOC|EXP|EVT)-[A-Z0-9]{2,})\b/gi)) {
    add(`rec:${match[1].toUpperCase()}`, match[1]);
  }
  return facts;
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
const OBLIGATION_PATTERNS: { re: RegExp; label: string }[] = [
  {
    re: /\b(our|the) agreement\b[^.?!]{0,100}\b(requires|require|required|says|states|provides|permits|permit|forbids|forbid|prohibits|prohibit|mandates|mandate|must|have to)\b/i,
    label: "agreement obligation",
  },
  {
    re: /\bparenting plan\b[^.?!]{0,100}\b(requires|require|required|says|states|provides|permits|permit|forbids|forbid|prohibits|prohibit|mandates|mandate|must|have to)\b/i,
    label: "parenting plan obligation",
  },
  {
    re: /\b(court order|the order|decree|statute|the law)\b[^.?!]{0,100}\b(requires|require|required|says|states|provides|permits|permit|forbids|forbid|prohibits|prohibit|mandates|mandate|must|have to)\b/i,
    label: "court or legal obligation",
  },
  {
    re: /\b(under|per) (our |the )?(agreement|parenting plan|court order|order|law|decree)\b/i,
    label: "per the order or agreement",
  },
  {
    re: /\b(our|the) court order\b/i,
    label: "court order cited",
  },
  {
    re: /\b(as outlined|as set out|as stated|according to|pursuant to)\b[^.?!]{0,60}\b(order|agreement|parenting plan|plan|decree)\b/i,
    label: "per the order or agreement",
  },
  { re: /\byou are required to\b/i, label: "you are required to" },
  { re: /\byou are (not )?(allowed|permitted) to\b/i, label: "permitted or forbidden" },
  {
    re: /\b(required|obligated|obliged) (by|under) (the |our )?(agreement|plan|order|law|decree)\b/i,
    label: "required by an instrument",
  },
  { re: /\bas required by\b/i, label: "as required by" },
];

const OBLIGATION_LABELS = new Set(OBLIGATION_PATTERNS.map((pattern) => pattern.label));

/**
 * The parent named this instrument and this duty. The message may say so.
 * That is the parent's assertion, not a claim that Sage retrieved the record.
 */
function parentSuppliedObligation(clause: string, source: string): boolean {
  const instrument = clause.match(
    /\b(?:court order|parenting plan|agreement|decree|statute|the law|the order)\b/
  );
  if (!instrument || !source.includes(instrument[0])) return false;
  const duty =
    /\b(?:requires|require|required|must|permits|permit|forbids|forbid|prohibits|prohibit|mandates|mandate|have to)\b/;
  if (!duty.test(clause)) return true;
  return duty.test(source);
}

const UNSOLICITED_PADDING: { re: RegExp; phrase: string }[] = [
  { re: /^(?:hi|hello|hey)\b[^,.!?\n]{0,48}[,!]?\s+/i, phrase: "hi" },
  { re: /\bi wanted to reach out\b[^.?!]{0,80}[.?!]?\s*/gi, phrase: "i wanted to reach out" },
  { re: /\bcan you help me understand\b\s*/gi, phrase: "can you help me understand" },
  {
    re: /\bi(?:'|’)d like to hear your perspective(?: on that)?\b[.?!]?\s*/gi,
    phrase: "i'd like to hear your perspective",
  },
  { re: /\bmy understanding is that\b\s*/gi, phrase: "my understanding" },
  { re: /\bi was wondering\b[^.?!]{0,40}[.?!]?\s*/gi, phrase: "i was wondering" },
  { re: /\bif that(?:'s| is) okay\b[.?!]?\s*/gi, phrase: "if that's okay" },
  { re: /\bi(?:'|’)d appreciate it\b[.?!]?\s*/gi, phrase: "i'd appreciate it" },
  { re: /\bi would appreciate it\b[.?!]?\s*/gi, phrase: "i would appreciate it" },
];

/**
 * The parent's information or question, without a greeting, sign-off, hedge, or
 * other padding the parent did not ask for. Direct questions stay direct.
 */
export function conciseOutboundBody(body: string, request: string): string {
  const original = body.trim();
  if (!original) return original;
  const asked = request.toLowerCase();
  let text = original;
  for (const item of UNSOLICITED_PADDING) {
    const requested =
      item.phrase === "hi" ? /\b(?:hi|hello|hey)\b/.test(asked) : asked.includes(item.phrase);
    if (requested) continue;
    text = text.replace(item.re, "");
  }
  text = text.replace(/\s+/g, " ").replace(/\s+([?.!,])/g, "$1").trim();
  if (!text) return original;
  return text.charAt(0).toUpperCase() + text.slice(1);
}

const NOTICE_WEEKDAYS = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"] as const;

function noticeWeekday(text: string): string | null {
  const match = text.toLowerCase().match(/\b(sunday|monday|tuesday|wednesday|thursday|friday|saturday)\b/);
  return match ? match[1] : null;
}

function clockPhrase(text: string): string | null {
  const match = text.match(/\b(\d{1,2}(?::\d{2})?)\s*(a\.?m\.?|p\.?m\.?)\b/i);
  if (!match) return null;
  return `${match[1]}${/^a/i.test(match[2]) ? "am" : "pm"}`;
}

function scheduleEvent(text: string): string | null {
  const match = text.toLowerCase().match(/\b(pick-?up|drop-?off|exchange|practice|parenting time|visitation)\b/);
  if (!match) return null;
  if (match[1].startsWith("pick")) return "pickup";
  if (match[1].startsWith("drop")) return "dropoff";
  return match[1];
}

/** The parent is asking for a fact only the co-parent has. That stays a question. */
function lacksCoparentFact(request: string): boolean {
  const lower = request.toLowerCase();
  if (/\bwhy\b/.test(lower)) return true;
  if (/\bwhat time\b/.test(lower) && !clockPhrase(request)) return true;
  if (/\bwhen\b/.test(lower) && !noticeWeekday(request) && !clockPhrase(request)) return true;
  if (/\bwhere\b/.test(lower) && !/\b(?:at|on|in)\s+[a-z]/i.test(request)) return true;
  if (/\bwhich\b/.test(lower) && !noticeWeekday(request) && !clockPhrase(request)) return true;
  if (/\bhow (?:much|long|many)\b/.test(lower)) return true;
  return false;
}

function statedDeadline(request: string): string | null {
  const match = request.match(
    /\bby\s+(sunday|monday|tuesday|wednesday|thursday|friday|saturday|tomorrow|tonight)\b/i
  );
  if (!match) return null;
  const word = match[1].toLowerCase();
  return word === "tomorrow" || word === "tonight" ? word : titleDay(word);
}

function dayBefore(day: string): string {
  const index = NOTICE_WEEKDAYS.indexOf(day as (typeof NOTICE_WEEKDAYS)[number]);
  return titleDay(NOTICE_WEEKDAYS[(index + 6) % 7]);
}

/**
 * Statement, implied deadline, and an invitation to object.
 * Null when the parent is asking for information they do not have, or stated no schedule.
 */
export function declarativeNotice(request: string): string | null {
  if (lacksCoparentFact(request)) return null;
  const day = noticeWeekday(request);
  const time = clockPhrase(request);
  if (!day && !time) return null;
  if (!/\b(confirm|tell|let|remind|notify|ask|draft|message|pickup|pick-up|drop-?off|practice)\b/i.test(request)) {
    return null;
  }
  return noticeFromParts(scheduleEvent(request), day, time, statedDeadline(request) ?? (day ? dayBefore(day) : null));
}

function opensWithQuestion(body: string): boolean {
  return /^(?:can|could|would|will|do|does|did|is|are|what|when|where|why|which|how)\b/i.test(body.trim()) || body.includes("?");
}

function noticeFromParts(
  event: string | null,
  day: string | null,
  time: string | null,
  deadline: string | null
): string | null {
  if (!day && !time && !event) return null;
  const dayLabel = day ? titleDay(day) : null;
  let statement: string;
  if (event && dayLabel && time) statement = `I have ${event} ${dayLabel} at ${time}.`;
  else if (event && dayLabel) statement = `I have ${event} ${dayLabel}.`;
  else if (event && time) statement = `I have ${event} at ${time}.`;
  else statement = `I have ${[dayLabel, time ? `at ${time}` : null].filter(Boolean).join(" ")}.`;
  const invite = deadline
    ? `Let me know by ${deadline} if that doesn't work.`
    : `Let me know if that doesn't work.`;
  return `${statement} ${invite}`;
}

function deadlineIn(text: string): string | null {
  return statedDeadline(text);
}

function isDeclarativeNotice(text: string): boolean {
  return /\blet me know\b/i.test(text) && !text.includes("?") && !!(scheduleEvent(text) || noticeWeekday(text) || clockPhrase(text));
}

/**
 * A revision of an existing notice changes only the named day or time.
 * The statement, deadline, and invitation to object stay.
 */
function preserveNoticeRevision(current: string, request: string): string | null {
  if (!isDeclarativeNotice(current)) return null;
  const newTime = clockPhrase(request);
  const newDay = noticeWeekday(request);
  if (!newTime && !newDay) return null;
  if (/\b(?:what time|when|where|why)\b/i.test(request) && !newTime && !newDay) return null;
  const day = newDay ?? noticeWeekday(current);
  const deadline =
    statedDeadline(request) ?? (newDay && day ? dayBefore(day) : null) ?? deadlineIn(current) ?? (day ? dayBefore(day) : null);
  return noticeFromParts(scheduleEvent(request) ?? scheduleEvent(current), day, newTime ?? clockPhrase(current), deadline);
}

/** A question the model wrote for known logistics becomes notice. A real question stays. */
export function applyMessageRegister(body: string, request: string, currentDraft?: string | null): string {
  const kept = currentDraft ? preserveNoticeRevision(currentDraft, request) : null;
  if (kept) return kept;
  const notice = declarativeNotice(request);
  if (!notice) return body;
  if (!opensWithQuestion(body) && /\blet me know\b/i.test(body) && !body.includes("?")) return body;
  return notice;
}

/** Claims that an agreement, plan, order, or law requires, permits, or forbids something the sources do not contain. */
export function unsupportedObligations(draft: string, sources: string): string[] {
  const source = sources.toLowerCase().replace(/\s+/g, " ");
  const problems: string[] = [];
  for (const pattern of OBLIGATION_PATTERNS) {
    const match = draft.match(pattern.re);
    if (!match) continue;
    const clause = match[0].toLowerCase().replace(/\s+/g, " ").trim();
    if (clause && (source.includes(clause) || parentSuppliedObligation(clause, source))) continue;
    problems.push(pattern.label);
  }
  return problems;
}

export function isObligationProblem(label: string): boolean {
  return OBLIGATION_LABELS.has(label);
}

const ADDRESSEE = "(?:him|her|them|my co-parent|(?!me\\b|you\\b)[A-Za-z][A-Za-z'-]{1,30})";

const INSTRUMENT_REQUEST = new RegExp(
  `\\b(?:tell|ask)\\s+${ADDRESSEE}\\b(?:\\s+that)?\\s+(?:our agreement|the agreement|the parenting plan|parenting plan|the court order|court order|the decree|the statute|the law|the order)\\s+(?:requires|require|required|says|states|provides|permits|permit|forbids|forbid|prohibits|prohibit|mandates|mandate|must|have to)\\s+([^.?!]+)`,
  "i"
);

const INSTRUCTION = new RegExp(
  `^(?:please\\s+)?(?:tell|ask|remind|let)\\s+${ADDRESSEE}\\b(?:\\s+know)?(?:\\s+that)?\\s+([\\s\\S]+)$`,
  "i"
);

const INSTRUMENT_LEAD =
  /\b(?:our|the)\s+(?:parenting plan|plan|agreement|court order|decree|statute|law|order)\s+(?:requires|require|required|says|states|provides|permits|permit|forbids|forbid|prohibits|prohibit|mandates|mandate|must|have to)\s+/i;

const INSTRUMENT_TRAIL =
  /\b(?:under|per)\s+(?:our\s+|the\s+)?(?:court order|parenting plan|agreement|decree|statute|law|order)\b/i;

/**
 * The parent's request with the instrument removed.
 * "Tell him the parenting plan requires a response within 48 hours" stays a request
 * for that response. "Remind him he's required to share medical decisions under our
 * court order" stays a request to decide together. Null when the text is not an
 * instruction to assert an instrument, or nothing remains to ask.
 */
export function requestWithoutInstrument(text: string): string | null {
  const direct = text.match(INSTRUMENT_REQUEST);
  if (direct) return phraseAsRequest(direct[1]);
  const instructed = text.match(INSTRUCTION);
  if (!instructed) return null;
  const remainder = instructed[1].trim();
  if (unsupportedObligations(remainder, "").length === 0 && !INSTRUMENT_LEAD.test(remainder) && !INSTRUMENT_TRAIL.test(remainder)) {
    return null;
  }
  const stripped = remainder
    .replace(/^(?:he|she|they)'s\s+/i, "")
    .replace(/^(?:he|she|they)\s+(?:is|are)\s+/i, "")
    .replace(INSTRUMENT_LEAD, "")
    .replace(/\b(?:required|obligated|obliged)\s+to\s+/i, "")
    .replace(/\b(?:have|has)\s+to\s+(?:be\s+)?/i, "")
    .replace(INSTRUMENT_TRAIL, "")
    .replace(/\s+/g, " ")
    .trim();
  return phraseAsRequest(stripped);
}

function phraseAsRequest(act: string): string | null {
  const text = act.replace(/\s+/g, " ").replace(/^[,.\s]+|[.?!,\s]+$/g, "").trim();
  if (text.length < 8) return null;
  const shared = text.match(/^share\s+(.+\bdecisions?)$/i);
  if (shared) return `I'd like us to make ${shared[1]} together going forward.`;
  const expenses = text.match(/^expenses\s+(?:have to be\s+|be\s+)?submitted\b(.*)$/i);
  if (expenses) {
    const when = expenses[1].replace(/\s+/g, " ").trim();
    return `Please submit expenses${when ? ` ${when}` : ""}.`;
  }
  if (/^a\s+/i.test(text)) {
    const draft = `I am asking for ${text}.`;
    return unsupportedObligations(draft, "").length === 0 ? draft : null;
  }
  const draft = `I'd like ${text}.`;
  return unsupportedObligations(draft, "").length === 0 ? draft : null;
}

/**
 * A co-parent body that is safe to show.
 * A parent-facing sentence, a copy of the instruction, or an unsupported obligation
 * is replaced by the request with the instrument removed. Null when nothing usable remains.
 */
export function usableOutboundBody(
  body: string | null | undefined,
  request: string,
  sources: string
): string | null {
  const text = (body ?? "").trim();
  if (
    text &&
    !isParentFacingCopy(text) &&
    !requestAsDraft(text, request) &&
    unsupportedObligations(text, sources).length === 0
  ) {
    return text;
  }
  const restated = requestWithoutInstrument(request);
  if (!restated || isParentFacingCopy(restated) || requestAsDraft(restated, request)) return null;
  if (unsupportedObligations(restated, sources).length === 0) return restated;
  return null;
}

/**
 * True when the co-parent body is the parent's private request, or contains that request.
 * An empty body is not this. A shorter sentence the drafter wrote is not this.
 */
export function requestAsDraft(body: string, request: string): boolean {
  const norm = (value: string) => value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  const draft = norm(body);
  const asked = norm(request);
  if (!draft || asked.length < 12) return false;
  if (!(draft === asked || draft.includes(asked))) return false;
  // The parent stated the question to send. An instruction to Sage still cannot be the body.
  if (lacksCoparentFact(request) && !/^(?:please\s+)?(?:tell|ask|remind|let|draft|message|notify|send)\b/i.test(request.trim())) {
    return false;
  }
  return true;
}

/**
 * A failed draft does not paste the request or the record into the co-parent body.
 * The caller already tried a rewrite. This is the sentence Sage can say on its own.
 */
export function factsOnlyDraft(_sources = "", _request = ""): string {
  return NO_DETAIL_REPLY;
}

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
  { re: /\bi wanted to reach out\b/i, label: "i wanted to reach out" },
  { re: /\bcan you help me understand\b/i, label: "can you help me understand" },
  { re: /\bi(?:'|’)d like to hear your perspective\b/i, label: "i'd like to hear your perspective" },
  { re: /\bmy understanding is that\b/i, label: "my understanding" },
  { re: /\bi was wondering\b/i, label: "i was wondering" },
  { re: /\bif that(?:'s| is) okay\b/i, label: "if that's okay" },
  { re: /\bi(?:'|’)d appreciate\b|\bi would appreciate\b/i, label: "i'd appreciate" },
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
    ...recordFacts(next).map((fact) => fact.key),
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
  const retractRecords = /\b(remove|drop|delete|without|do not include|don't include)\b/i.test(guidance);
  if (!retractRecords) {
    for (const record of recordFacts(previous)) {
      if (!present.has(record.key)) missing.push(record.label);
    }
  }
  return missing;
}

/**
 * Put dropped record labels (MSG-014, DOC-018) back when a tone pass omitted them.
 * Dates, times, and amounts stay with the existing outbound fact check; appending them here
 * would duplicate a shorter form already in the sentence.
 */
export function restoreDroppedEvidence(next: string, previous: string, guidance: string): string {
  const body = next.trim();
  if (!body) return body;
  const retractRecords = /\b(remove|drop|delete|without|do not include|don't include)\b/i.test(guidance);
  if (retractRecords) return body;
  const present = new Set(recordFacts(body).map((fact) => fact.key));
  const missing: string[] = [];
  for (const fact of recordFacts(previous)) {
    if (!present.has(fact.key) && !body.toLowerCase().includes(fact.label.toLowerCase())) {
      missing.push(fact.label);
    }
  }
  for (const match of previous.matchAll(/\b(20\d{2}-\d{2}-\d{2})\b/g)) {
    if (!body.includes(match[1])) missing.push(match[1]);
  }
  if (missing.length === 0) return body;
  return `${body} ${[...new Set(missing)].join("; ")}`.trim();
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
