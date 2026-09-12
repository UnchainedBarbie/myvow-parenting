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

/**
 * Resolve Understanding-extracted child names to case children ids.
 * Exact match first, then unique prefix; never fuzzy-guess.
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

    resolved.push({
      name,
      child_id: null,
      matched_name: null,
      method: "unresolved",
    });
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

function weekdayNeedsClarification(raw: string, weekday: string): DateResolution {
  const label = weekday.charAt(0).toUpperCase() + weekday.slice(1);
  return {
    raw,
    status: "needs_clarification",
    iso: null,
    reason: `Which ${label}? Please confirm the date.`,
  };
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

  // ISO YYYY-MM-DD
  const isoMatch = lower.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (isoMatch) {
    const y = Number(isoMatch[1]);
    const m = Number(isoMatch[2]);
    const d = Number(isoMatch[3]);
    if (isValidYmd(y, m, d)) {
      return {
        raw: original,
        status: "resolved",
        iso: formatIso({ y, m, d }),
        reason: "Explicit ISO date with year",
      };
    }
  }

  // Numeric with year: M/D/YYYY or M-D-YYYY
  const numericYear = lower.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})$/);
  if (numericYear) {
    const m = Number(numericYear[1]);
    const d = Number(numericYear[2]);
    const y = Number(numericYear[3]);
    if (isValidYmd(y, m, d)) {
      return {
        raw: original,
        status: "resolved",
        iso: formatIso({ y, m, d }),
        reason: "Explicit date with year",
      };
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
      return {
        raw: original,
        status: "resolved",
        iso: formatIso({ y, m, d }),
        reason: "Explicit date with year",
      };
    }
  }

  // Month name + day, no year: "Jun 26", "June 26th"
  const monthDay = lower.match(/^([a-z]+)\s+(\d{1,2})(?:st|nd|rd|th)?$/);
  if (monthDay) {
    const m = MONTHS[monthDay[1]];
    const d = Number(monthDay[2]);
    if (m && isValidYmd(todayYmd.y, m, d)) {
      let candidate: Ymd = { y: todayYmd.y, m, d };
      if (compareYmd(candidate, todayYmd) < 0) {
        candidate = { y: todayYmd.y + 1, m, d };
      }
      return {
        raw: original,
        status: "resolved",
        iso: formatIso(candidate),
        reason:
          candidate.y === todayYmd.y
            ? "Month/day in current year"
            : "Month/day already passed — rolled to next year",
      };
    }
  }

  // Numeric without year: M/D or M-D
  const numericNoYear = lower.match(/^(\d{1,2})[\/\-](\d{1,2})$/);
  if (numericNoYear) {
    const m = Number(numericNoYear[1]);
    const d = Number(numericNoYear[2]);
    if (isValidYmd(todayYmd.y, m, d)) {
      let candidate: Ymd = { y: todayYmd.y, m, d };
      if (compareYmd(candidate, todayYmd) < 0) {
        candidate = { y: todayYmd.y + 1, m, d };
      }
      return {
        raw: original,
        status: "resolved",
        iso: formatIso(candidate),
        reason:
          candidate.y === todayYmd.y
            ? "Month/day in current year"
            : "Month/day already passed — rolled to next year",
      };
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
