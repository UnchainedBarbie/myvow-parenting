/**
 * Event subject and schedule times taken from what was said,
 * not from Sage's sentence to the parent.
 */

const SUBJECTS = [
  "track meet",
  "wrestling match",
  "swim meet",
  "choir concert",
  "band concert",
  "school concert",
  "orchestra concert",
  "soccer practice",
  "soccer game",
  "piano lesson",
  "dance recital",
  "parent teacher conference",
  "dentist appointment",
  "doctor appointment",
  "choir",
  "wrestling",
  "concert",
  "practice",
  "recital",
  "rehearsal",
  "tournament",
  "appointment",
];

function titleCase(phrase: string): string {
  return phrase
    .split(/\s+/)
    .map((word) => (word ? word[0].toUpperCase() + word.slice(1) : word))
    .join(" ");
}

/** Longest known event phrase in the texts, or null. */
export function eventSubjectFromTexts(texts: string[]): string | null {
  const blob = texts.filter(Boolean).join(" \n ");
  if (!blob.trim()) return null;
  for (const phrase of SUBJECTS) {
    const re = new RegExp(`\\b${phrase.replace(/\s+/g, "\\s+")}\\b`, "i");
    if (re.test(blob)) return titleCase(phrase);
  }
  return null;
}

/**
 * Keep a more specific earlier subject when this turn only repeated the head noun.
 * "concert" plus an earlier "choir concert" stays "choir concert".
 */
export function preferEventSubject(
  current: string | null,
  earlier: string | null
): string | null {
  if (!current) return earlier;
  if (!earlier) return current;
  const now = current.toLowerCase();
  const prior = earlier.toLowerCase();
  if (prior !== now && prior.includes(now) && prior.length > now.length) return earlier;
  return current;
}

export type ScheduleTimes = {
  /** When the event itself starts, HH:mm. */
  start: string | null;
  /** When the child needs to arrive, if that is a separate time, HH:mm. */
  arrival: string | null;
};

function toHHmm(hourRaw: string, minuteRaw: string | undefined, meridiemRaw: string | undefined): string | null {
  let hour = Number(hourRaw);
  const minute = minuteRaw ? Number(minuteRaw) : 0;
  if (!Number.isFinite(hour) || !Number.isFinite(minute) || minute > 59) return null;
  const meridiem = (meridiemRaw ?? "").toLowerCase().replace(/\./g, "");
  if (meridiem.startsWith("p")) {
    if (hour < 12) hour += 12;
  } else if (meridiem.startsWith("a")) {
    if (hour === 12) hour = 0;
  } else if (hour >= 1 && hour <= 7) {
    hour += 12;
  } else if (hour >= 8 && hour <= 11) {
    return null;
  }
  if (hour > 23) return null;
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

function firstClock(text: string, pattern: RegExp): string | null {
  const match = text.match(pattern);
  if (!match) return null;
  return toHHmm(match[1], match[2], match[3]);
}

/** Arrival and start clocks stated in the message. Bare 1–7 without am/pm is evening. */
export function parseScheduleTimes(text: string): ScheduleTimes {
  const arrival = firstClock(
    text,
    /\b(?:arriv(?:e|es|al)|be there|needs to be there)\s+at\s+(\d{1,2})(?::(\d{2}))?\s*(a\.?m\.?|p\.?m\.?)?/i
  );
  const start = firstClock(
    text,
    /\b(?:starts?|starting|begins?)\s+at\s+(\d{1,2})(?::(\d{2}))?\s*(a\.?m\.?|p\.?m\.?)?/i
  );
  return { start, arrival };
}

export function formatClockLabel(hhmm: string): string {
  const [hRaw, mRaw] = hhmm.split(":");
  const hour24 = Number(hRaw);
  const minute = Number(mRaw);
  if (!Number.isFinite(hour24) || !Number.isFinite(minute)) return hhmm;
  const meridiem = hour24 >= 12 ? "PM" : "AM";
  const hour12 = hour24 % 12 || 12;
  return `${hour12}:${String(minute).padStart(2, "0")} ${meridiem}`;
}
