/**
 * Sage Engine — Resolver layer.
 * Deterministic, no LLM.
 * - Children: names → child_ids (DB)
 * - Dates: raw language → ISO when unambiguous (pure; no DB)
 */

import { getServiceRoleClient } from "@/lib/supabase/server";

export type ChildResolution = {
  name: string;
  child_id: string | null;
  matched_name: string | null;
  method: "exact" | "prefix" | "unresolved";
};

export type ResolveChildrenResult = {
  child_ids: string[];
  resolved: ChildResolution[];
};

type CaseChild = {
  id: string;
  first_name: string | null;
};

function normalize(s: string): string {
  return s.trim().toLowerCase();
}

function matchExactFirstName(
  children: CaseChild[],
  needle: string
): CaseChild[] {
  if (!needle) return [];
  return children.filter((c) => normalize(c.first_name ?? "") === needle);
}

function matchPrefixFirstName(
  children: CaseChild[],
  needle: string
): CaseChild[] {
  if (!needle) return [];
  return children.filter((c) => {
    const first = normalize(c.first_name ?? "");
    return first.length > 0 && first.startsWith(needle);
  });
}

function unresolvedOf(name: string): ChildResolution {
  return {
    name,
    child_id: null,
    matched_name: null,
    method: "unresolved",
  };
}

function resolvedOf(
  name: string,
  child: CaseChild,
  method: "exact" | "prefix"
): ChildResolution {
  return {
    name,
    child_id: child.id,
    matched_name: child.first_name,
    method,
  };
}

/**
 * Resolve Understanding-extracted child names to case children ids.
 * Exact match first, then unique prefix; then last-name-first / full-name
 * fallbacks. Never fuzzy-guess: any ambiguous match stays unresolved.
 */
export async function resolveChildren(
  caseId: string,
  extractedNames: string[]
): Promise<ResolveChildrenResult> {
  if (!extractedNames.length) {
    return { child_ids: [], resolved: [] };
  }

  const admin = getServiceRoleClient();
  const { data, error } = await admin
    .from("children")
    .select("id, first_name")
    .eq("case_id", caseId)
    .is("deleted_at", null);

  if (error) {
    console.error("[sage/resolver] failed to load children:", error);
    return {
      child_ids: [],
      resolved: extractedNames.map((name) => ({
        name,
        child_id: null,
        matched_name: null,
        method: "unresolved" as const,
      })),
    };
  }

  const children = (data ?? []) as CaseChild[];
  const resolved: ChildResolution[] = [];

  for (const name of extractedNames) {
    const needle = normalize(name);
    if (!needle) {
      resolved.push({
        name,
        child_id: null,
        matched_name: null,
        method: "unresolved",
      });
      continue;
    }

    const exact = children.filter(
      (c) => normalize(c.first_name ?? "") === needle
    );
    if (exact.length === 1) {
      resolved.push({
        name,
        child_id: exact[0].id,
        matched_name: exact[0].first_name,
        method: "exact",
      });
      continue;
    }
    if (exact.length > 1) {
      // Ambiguous exact duplicates — do not guess.
      resolved.push({
        name,
        child_id: null,
        matched_name: null,
        method: "unresolved",
      });
      continue;
    }

    const prefixMatches = children.filter((c) => {
      const first = normalize(c.first_name ?? "");
      return first.length > 0 && first.startsWith(needle);
    });
    if (prefixMatches.length === 1) {
      resolved.push({
        name,
        child_id: prefixMatches[0].id,
        matched_name: prefixMatches[0].first_name,
        method: "prefix",
      });
      continue;
    }

    // Last-name-first: "Walker, Kyle" → match the given name after the comma.
    const commaAt = needle.indexOf(",");
    if (commaAt >= 0) {
      const afterComma = normalize(needle.slice(commaAt + 1));
      if (afterComma) {
        const commaExact = matchExactFirstName(children, afterComma);
        if (commaExact.length === 1) {
          resolved.push(resolvedOf(name, commaExact[0], "exact"));
          continue;
        }
        if (commaExact.length > 1) {
          resolved.push(unresolvedOf(name));
          continue;
        }
        const commaPrefix = matchPrefixFirstName(children, afterComma);
        if (commaPrefix.length === 1) {
          resolved.push(resolvedOf(name, commaPrefix[0], "prefix"));
          continue;
        }
        if (commaPrefix.length > 1) {
          resolved.push(unresolvedOf(name));
          continue;
        }
      }
    }

    // Full name: "KYLE WALKER" → unique exact first_name among whitespace tokens.
    const tokens = needle.split(/\s+/).filter(Boolean);
    const tokenMatchedIds = new Set<string>();
    let tokenAmbiguous = false;
    for (const token of tokens) {
      const tokenExact = matchExactFirstName(children, token);
      if (tokenExact.length > 1) {
        tokenAmbiguous = true;
        break;
      }
      if (tokenExact.length === 1) {
        tokenMatchedIds.add(tokenExact[0].id);
      }
    }
    if (tokenAmbiguous || tokenMatchedIds.size > 1) {
      resolved.push(unresolvedOf(name));
      continue;
    }
    if (tokenMatchedIds.size === 1) {
      const id = [...tokenMatchedIds][0];
      const child = children.find((c) => c.id === id);
      if (child) {
        resolved.push(resolvedOf(name, child, "exact"));
        continue;
      }
    }

    resolved.push(unresolvedOf(name));
  }

  const child_ids = [
    ...new Set(
      resolved
        .map((r) => r.child_id)
        .filter((id): id is string => typeof id === "string" && id.length > 0)
    ),
  ];

  return { child_ids, resolved };
}

// ─── Date resolution (pure, no DB) ───────────────────────────────────────────

export type DateResolution = {
  raw: string;
  status: "resolved" | "needs_clarification" | "unresolved";
  iso: string | null;
  reason: string;
};

type Ymd = { y: number; m: number; d: number };

const MONTHS: Record<string, number> = {
  january: 1,
  jan: 1,
  february: 2,
  feb: 2,
  march: 3,
  mar: 3,
  april: 4,
  apr: 4,
  may: 5,
  june: 6,
  jun: 6,
  july: 7,
  jul: 7,
  august: 8,
  aug: 8,
  september: 9,
  sep: 9,
  sept: 9,
  october: 10,
  oct: 10,
  november: 11,
  nov: 11,
  december: 12,
  dec: 12,
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

const WEEKDAY_ALIASES: Record<string, string> = {
  sun: "sunday",
  sunday: "sunday",
  mon: "monday",
  monday: "monday",
  tue: "tuesday",
  tues: "tuesday",
  tuesday: "tuesday",
  wed: "wednesday",
  wednesday: "wednesday",
  thu: "thursday",
  thur: "thursday",
  thurs: "thursday",
  thursday: "thursday",
  fri: "friday",
  friday: "friday",
  sat: "saturday",
  saturday: "saturday",
};

function ymdInTimezone(date: Date, timezone: string): Ymd {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const get = (type: string) =>
    Number(parts.find((p) => p.type === type)?.value ?? NaN);
  return { y: get("year"), m: get("month"), d: get("day") };
}

function formatIso({ y, m, d }: Ymd): string {
  return `${String(y).padStart(4, "0")}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

function addCalendarDays({ y, m, d }: Ymd, delta: number): Ymd {
  const dt = new Date(Date.UTC(y, m - 1, d + delta, 12, 0, 0));
  return {
    y: dt.getUTCFullYear(),
    m: dt.getUTCMonth() + 1,
    d: dt.getUTCDate(),
  };
}

function isValidYmd(y: number, m: number, d: number): boolean {
  if (!Number.isFinite(y) || !Number.isFinite(m) || !Number.isFinite(d)) return false;
  if (m < 1 || m > 12 || d < 1 || d > 31) return false;
  const dt = new Date(Date.UTC(y, m - 1, d, 12, 0, 0));
  return (
    dt.getUTCFullYear() === y &&
    dt.getUTCMonth() + 1 === m &&
    dt.getUTCDate() === d
  );
}

function compareYmd(a: Ymd, b: Ymd): number {
  if (a.y !== b.y) return a.y - b.y;
  if (a.m !== b.m) return a.m - b.m;
  return a.d - b.d;
}

function resolveWeekdayToken(token: string): string | null {
  return WEEKDAY_ALIASES[token] ?? null;
}

function containsFourDigitYear(s: string): boolean {
  return /\b(?:19|20)\d{2}\b/.test(s);
}

/** Current year, or next year if that month/day already passed. Never a prior year. */
function rollForwardMonthDay(m: number, d: number, todayYmd: Ymd): Ymd | null {
  const tryYear = (y: number): Ymd | null =>
    isValidYmd(y, m, d) ? { y, m, d } : null;
  const thisYear = tryYear(todayYmd.y);
  if (thisYear && compareYmd(thisYear, todayYmd) >= 0) return thisYear;
  return tryYear(todayYmd.y + 1);
}

function resolved(
  raw: string,
  ymd: Ymd,
  reason: string
): DateResolution {
  return {
    raw,
    status: "resolved",
    iso: formatIso(ymd),
    reason,
  };
}

/**
 * Yearless dates only: roll a past month/day to this year or next.
 * Explicit years are returned unchanged.
 */
function coerceUpcomingYear(
  ymd: Ymd,
  todayYmd: Ymd,
  yearExplicit: boolean
): { ymd: Ymd; reasonSuffix: string } {
  if (yearExplicit) {
    return { ymd, reasonSuffix: "" };
  }
  if (ymd.y < todayYmd.y) {
    const rolled = rollForwardMonthDay(ymd.m, ymd.d, todayYmd);
    if (rolled) {
      return {
        ymd: rolled,
        reasonSuffix:
          rolled.y === todayYmd.y
            ? " (past year ignored — current year)"
            : " (past year ignored — rolled to next year)",
      };
    }
  }
  if (compareYmd(ymd, todayYmd) < 0) {
    const rolled = rollForwardMonthDay(ymd.m, ymd.d, todayYmd);
    if (rolled) {
      return {
        ymd: rolled,
        reasonSuffix: " (already passed — rolled to next year)",
      };
    }
  }
  return { ymd, reasonSuffix: "" };
}

function weekdayNeedsClarification(raw: string, weekday: string): DateResolution {
  const label = weekday.charAt(0).toUpperCase() + weekday.slice(1);
  return {
    raw,
    status: "needs_clarification",
    iso: null,
    reason: `Which ${label}? Please confirm the date.`,
  };
}

function resolveMonthDayNoYear(
  m: number,
  d: number,
  todayYmd: Ymd,
  original: string
): DateResolution | null {
  const rolled = rollForwardMonthDay(m, d, todayYmd);
  if (!rolled) return null;
  return resolved(
    original,
    rolled,
    rolled.y === todayYmd.y
      ? "Month/day in current year"
      : "Month/day already passed — rolled to next year"
  );
}

function finishWithYear(
  original: string,
  ymd: Ymd,
  todayYmd: Ymd,
  yearExplicit: boolean,
  reason: string
): DateResolution {
  if (yearExplicit) {
    return resolved(original, ymd, reason);
  }
  const coerced = coerceUpcomingYear(ymd, todayYmd, yearExplicit);
  return resolved(original, coerced.ymd, reason + coerced.reasonSuffix);
}

/**
 * Prefer the user-written date (e.g. "9/15") over an LLM ISO that invented a year.
 */
export function rawForDateResolver(d: { raw?: string; value?: string }): string {
  const raw = (d.raw ?? "").trim();
  const value = (d.value ?? "").trim();
  if (raw && !containsFourDigitYear(raw)) return raw;
  if (raw) return raw;
  return value;
}

/**
 * Resolve raw date language to YYYY-MM-DD only when unambiguous.
 * Ambiguous phrases → needs_clarification (never silent guess).
 */
export function resolveDate(
  raw: string,
  today: Date,
  timezone: string = "America/Denver"
): DateResolution {
  const original = raw;
  const text = raw.trim().replace(/\s+/g, " ");
  const lower = text.toLowerCase();

  if (!lower) {
    return {
      raw: original,
      status: "unresolved",
      iso: null,
      reason: "Empty date string",
    };
  }

  const todayYmd = ymdInTimezone(today, timezone);

  if (lower === "today") {
    return {
      raw: original,
      status: "resolved",
      iso: formatIso(todayYmd),
      reason: "Relative: today",
    };
  }
  if (lower === "tomorrow") {
    return {
      raw: original,
      status: "resolved",
      iso: formatIso(addCalendarDays(todayYmd, 1)),
      reason: "Relative: tomorrow",
    };
  }
  if (lower === "yesterday") {
    return {
      raw: original,
      status: "resolved",
      iso: formatIso(addCalendarDays(todayYmd, -1)),
      reason: "Relative: yesterday",
    };
  }

  // Vague relative phrases
  if (
    /^(soon|later|later this week|this week|in a few days|sometime|asap)$/i.test(
      lower
    )
  ) {
    return {
      raw: original,
      status: "needs_clarification",
      iso: null,
      reason: "Relative phrase is ambiguous — please confirm a date.",
    };
  }

  // "the 5th" / "the 15th" with no month
  if (/^the\s+\d{1,2}(st|nd|rd|th)?$/i.test(lower)) {
    return {
      raw: original,
      status: "needs_clarification",
      iso: null,
      reason: "Day-of-month without a month — please confirm the date.",
    };
  }

  // this/next <weekday>, <weekday> next week
  const thisNext = lower.match(
    /^(this|next)\s+([a-z]+)$/
  );
  if (thisNext) {
    const wd = resolveWeekdayToken(thisNext[2]);
    if (wd) return weekdayNeedsClarification(original, wd);
  }
  const nextWeek = lower.match(/^([a-z]+)\s+next\s+week$/);
  if (nextWeek) {
    const wd = resolveWeekdayToken(nextWeek[1]);
    if (wd) return weekdayNeedsClarification(original, wd);
  }

  // Bare weekday (including abbreviations)
  const bareWd = resolveWeekdayToken(lower);
  if (bareWd && WEEKDAYS.includes(bareWd as (typeof WEEKDAYS)[number])) {
    return weekdayNeedsClarification(original, bareWd);
  }

  // ISO YYYY-MM-DD (full string). Keep the stated year as-is.
  const isoMatch = lower.match(/^(\d{4})-(\d{1,2})-(\d{1,2})(?:[t\s].*)?$/);
  if (isoMatch) {
    const y = Number(isoMatch[1]);
    const m = Number(isoMatch[2]);
    const d = Number(isoMatch[3]);
    if (isValidYmd(y, m, d)) {
      return finishWithYear(
        original,
        { y, m, d },
        todayYmd,
        true,
        "Explicit ISO date with year"
      );
    }
  }

  // Numeric with year: M/D/YYYY or M-D-YYYY
  const numericYear = lower.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})$/);
  if (numericYear) {
    const m = Number(numericYear[1]);
    const d = Number(numericYear[2]);
    const y = Number(numericYear[3]);
    if (isValidYmd(y, m, d)) {
      return finishWithYear(
        original,
        { y, m, d },
        todayYmd,
        true,
        "Explicit date with year"
      );
    }
  }

  // Month name + day + year: "June 26 2026", "June 26, 2026"
  const monthDayYear = lower.match(
    /^([a-z]+)\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+(\d{4})$/
  );
  if (monthDayYear) {
    const m = MONTHS[monthDayYear[1]];
    const d = Number(monthDayYear[2]);
    const y = Number(monthDayYear[3]);
    if (m && isValidYmd(y, m, d)) {
      return finishWithYear(
        original,
        { y, m, d },
        todayYmd,
        true,
        "Explicit date with year"
      );
    }
  }

  // Month name + day, no year: "Jun 26", "June 26th"
  const monthDay = lower.match(/^([a-z]+)\s+(\d{1,2})(?:st|nd|rd|th)?$/);
  if (monthDay) {
    const m = MONTHS[monthDay[1]];
    const d = Number(monthDay[2]);
    if (m) {
      const hit = resolveMonthDayNoYear(m, d, todayYmd, original);
      if (hit) return hit;
    }
  }

  // Numeric without year: M/D or M-D (exact)
  const numericNoYear = lower.match(/^(\d{1,2})[\/\-](\d{1,2})$/);
  if (numericNoYear) {
    const m = Number(numericNoYear[1]);
    const d = Number(numericNoYear[2]);
    const hit = resolveMonthDayNoYear(m, d, todayYmd, original);
    if (hit) return hit;
  }

  // Same yearless rules when the date is embedded ("on 9/15 at 6pm", "Jun 26 at 6pm")
  if (!containsFourDigitYear(lower)) {
    const embeddedNumeric = lower.match(/\b(\d{1,2})[\/\-](\d{1,2})\b/);
    if (embeddedNumeric) {
      const m = Number(embeddedNumeric[1]);
      const d = Number(embeddedNumeric[2]);
      const hit = resolveMonthDayNoYear(m, d, todayYmd, original);
      if (hit) return hit;
    }
    const embeddedMonth = lower.match(
      /\b([a-z]+)\s+(\d{1,2})(?:st|nd|rd|th)?\b/
    );
    if (embeddedMonth) {
      const m = MONTHS[embeddedMonth[1]];
      const d = Number(embeddedMonth[2]);
      if (m) {
        const hit = resolveMonthDayNoYear(m, d, todayYmd, original);
        if (hit) return hit;
      }
    }
  }

  return {
    raw: original,
    status: "unresolved",
    iso: null,
    reason: "Could not parse as a date",
  };
}

export function resolveDates(
  raws: { raw: string }[],
  today: Date,
  timezone: string = "America/Denver"
): DateResolution[] {
  return raws.map((r) => resolveDate(r.raw, today, timezone));
}
