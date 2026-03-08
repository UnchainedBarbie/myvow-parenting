/**
 * Rotation-based custody for calendar overlay.
 * Used when schedule_type is 7/7, 5/2/2/5, or 2/2/3.
 * PATTERNS are defined in calendar-with-custody.tsx; duplicated here to avoid circular import.
 */

export type CustodySchedule = {
  schedule_type: string;
  rotation_start_date: string | null;
  user_starts_first: boolean | null;
  /** For schedule_type=manual: 14-element array "user"|"coparent"|"neither", day 0 = rotation_start_date. */
  manual_pattern?: (string | null)[] | null;
};

/** Parse YYYY-MM-DD as local midnight (no UTC offset). Use for both rotation_start_date and target date. */
function parseLocalDate(dateStr: string): Date {
  const [year, month, day] = dateStr.split("-").map(Number);
  return new Date(year, month - 1, day);
}

/** Parse YYYY-MM-DD as local date; returns null if missing or invalid. */
function parseRotationStartDate(isoDate: string | null): Date | null {
  if (!isoDate || typeof isoDate !== "string") return null;
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(isoDate.trim());
  if (!match) return null;
  return parseLocalDate(isoDate.trim().slice(0, 10));
}

const PATTERNS: Record<string, string[]> = {
  "7/7": ["U", "U", "U", "U", "U", "U", "U", "C", "C", "C", "C", "C", "C", "C"],
  seven_seven: ["U", "U", "U", "U", "U", "U", "U", "C", "C", "C", "C", "C", "C", "C"],
  /** 5/2/2/5: 14-day cycle — U(5), C(2), U(2), C(5). Index 0-4 U, 5-6 C, 7-8 U, 9-13 C. */
  "5/2/2/5": ["U", "U", "U", "U", "U", "C", "C", "U", "U", "C", "C", "C", "C", "C"],
  five_two_two_five: ["U", "U", "U", "U", "U", "C", "C", "U", "U", "C", "C", "C", "C", "C"],
  "2/2/3": ["U", "U", "C", "C", "U", "U", "U", "C", "C", "C"],
  two_two_three: ["U", "U", "C", "C", "U", "U", "U", "C", "C", "C"],
};

/** Map canonical (from API) to a key that exists in PATTERNS. */
const CANONICAL_TO_PATTERN_KEY: Record<string, string> = {
  week_on_week_off: "7/7",
  five_two_two_five: "5/2/2/5",
  two_two_three: "2/2/3",
};

/** Display and snake_case both map to canonical key for rotation logic. */
const SCHEDULE_TYPE_ALIASES: Record<string, "week_on_week_off" | "five_two_two_five" | "two_two_three" | "manual"> = {
  "7/7": "week_on_week_off",
  seven_seven: "week_on_week_off",
  week_on_week_off: "week_on_week_off",
  "5/2/2/5": "five_two_two_five",
  five_two_two_five: "five_two_two_five",
  "2/2/3": "two_two_three",
  two_two_three: "two_two_three",
  manual: "manual",
};

function normalizeScheduleType(
  scheduleType: string
): "week_on_week_off" | "five_two_two_five" | "two_two_three" | "manual" | null {
  const key = scheduleType?.trim?.() ?? "";
  return (SCHEDULE_TYPE_ALIASES[key] as typeof SCHEDULE_TYPE_ALIASES[string]) ?? null;
}

/**
 * Returns 'user' or 'coparent' for the given date based on rotation or manual pattern.
 * For manual: uses manual_pattern as cycle array anchored to rotation_start_date; "neither" → null.
 * Returns null if schedule is school_year or unrecognized, or manual with no pattern / no rotation_start_date.
 */
export function getCustodyFromRotation(
  date: Date,
  schedule: CustodySchedule | null
): "user" | "coparent" | null {
  console.log("[getCustodyFromRotation] called with:", {
    schedule_type: schedule?.schedule_type,
    rotation_start_date: schedule?.rotation_start_date,
    has_manual_pattern: !!schedule?.manual_pattern,
    manual_pattern_length: schedule?.manual_pattern?.length,
  });
  if (!schedule) return null;
  if (!schedule.rotation_start_date) return null;
  const st = schedule.schedule_type?.trim?.() ?? "";
  console.log("[getCustodyFromRotation] st:", st, "isManual:", st === "manual");
  if (st === "school_year") return null;

  if (st === "manual") {
    const pattern = schedule.manual_pattern;
    if (!Array.isArray(pattern) || pattern.length === 0) return null;
    const start = parseRotationStartDate(schedule.rotation_start_date);
    if (!start) return null;
    const dateStr = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
    const targetDate = parseLocalDate(dateStr);
    const daysSinceStart = Math.round((targetDate.getTime() - start.getTime()) / 86400000);
    const cycleLength = pattern.length;
    const cyclePos = ((daysSinceStart % cycleLength) + cycleLength) % cycleLength;
    const value = pattern[cyclePos];
    if (value === "user") return "user";
    if (value === "coparent") return "coparent";
    return null;
  }

  const start = parseRotationStartDate(schedule.rotation_start_date);
  const dateStr = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
  const targetDate = parseLocalDate(dateStr);
  const daysSinceStart = start
    ? Math.round((targetDate.getTime() - start.getTime()) / 86400000)
    : 0;

  const canonical = normalizeScheduleType(schedule.schedule_type);
  if (canonical === null || canonical === "manual") return null;
  if (!start) return null;

  const userStartsFirst = schedule.user_starts_first !== false;
  const patternKey =
    schedule.schedule_type != null && PATTERNS[schedule.schedule_type]
      ? schedule.schedule_type
      : (canonical && CANONICAL_TO_PATTERN_KEY[canonical]) ?? null;
  const pattern = patternKey ? PATTERNS[patternKey] : null;
  if (!pattern || pattern.length === 0) return userStartsFirst ? "user" : "coparent";

  const cycleLength = pattern.length;
  const cyclePos = ((daysSinceStart % cycleLength) + cycleLength) % cycleLength;
  const isFiveTwoTwoFive =
    canonical === "five_two_two_five" ||
    schedule.schedule_type === "5/2/2/5" ||
    schedule.schedule_type === "five_two_two_five";
  const isMar1 = date.getMonth() === 2 && date.getDate() === 1;
  if (isFiveTwoTwoFive && isMar1) {
    console.log("[5/2/2/5 debug] pattern:", pattern, "daysSinceStart:", daysSinceStart, "pos:", cyclePos, "owner:", pattern[cyclePos]);
  }
  const letter = pattern[cyclePos];
  const isUser = letter === "U";
  const result = userStartsFirst ? isUser : !isUser;
  return result ? "user" : "coparent";
}

/**
 * Walk forward from fromDate until custody owner changes. Used for "days until switch" and next block highlight.
 * Returns { daysUntilSwitch, nextOwner, firstDayOfNextBlockKey }.
 * firstDayOfNextBlockKey is YYYY-MM-DD of the first day with the other parent.
 */
export function getCustodySwitchInfo(
  schedule: CustodySchedule | null,
  fromDate: Date
): { daysUntilSwitch: number; nextOwner: "user" | "coparent" | null; firstDayOfNextBlockKey: string | null } {
  if (!schedule) return { daysUntilSwitch: 0, nextOwner: null, firstDayOfNextBlockKey: null };
  const current = getCustodyFromRotation(fromDate, schedule);
  if (current === null) return { daysUntilSwitch: 0, nextOwner: null, firstDayOfNextBlockKey: null };
  const nextOwner = current === "user" ? "coparent" : "user";
  for (let d = 1; d <= 366; d++) {
    const next = new Date(fromDate.getFullYear(), fromDate.getMonth(), fromDate.getDate() + d);
    const cust = getCustodyFromRotation(next, schedule);
    if (cust === nextOwner) {
      const y = next.getFullYear();
      const m = String(next.getMonth() + 1).padStart(2, "0");
      const day = String(next.getDate()).padStart(2, "0");
      return { daysUntilSwitch: d, nextOwner, firstDayOfNextBlockKey: `${y}-${m}-${day}` };
    }
  }
  return { daysUntilSwitch: 0, nextOwner: null, firstDayOfNextBlockKey: null };
}
