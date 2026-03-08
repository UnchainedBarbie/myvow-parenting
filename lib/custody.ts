/**
 * Custody schedule and rotation logic for calendar overlay.
 * Patterns: user (U) vs coparent (C); user_starts_first determines who is U in the first block.
 */

export type CustodySchedule = {
  schedule_type: string;
  rotation_start_date: string | null;
  user_starts_first: boolean | null;
};

export type HolidayCustodyOverride = {
  start_date: string;
  end_date: string;
  custodial_parent: string;
};

const STORAGE_KEY = "myvow_custody_overlay";

function daysBetween(start: Date, end: Date): number {
  const a = new Date(start.getFullYear(), start.getMonth(), start.getDate());
  const b = new Date(end.getFullYear(), end.getMonth(), end.getDate());
  return Math.floor((b.getTime() - a.getTime()) / 86400000);
}

/** True = first block in pattern (U), false = second (C). */
function cycleWeekOnWeekOff(position: number): boolean {
  return position < 7; // UUUUUUU CCCCCCC
}

/** 5/2/2/5: UUUUU CC UU CCCCC — first block = U at 0-4, 7-8 */
function cycleFiveTwoTwoFive(position: number): boolean {
  return position <= 4 || (position >= 7 && position <= 8);
}

/** 2/2/3: UU CC UUU CC UU CCC — first block at 0-1, 4-6, 9-10 */
function cycleTwoTwoThree(position: number): boolean {
  return position <= 1 || (position >= 4 && position <= 6) || (position >= 9 && position <= 10);
}

/**
 * Compute custody for a single date from the rotation schedule.
 * Returns 'user' (current user) or 'coparent'.
 * For "manual" schedule type, returns 'user' (no rotation; user marks on calendar).
 */
export function computeCustodyForDate(
  date: Date,
  schedule: CustodySchedule | null,
  options?: {
    holidayOverrides?: HolidayCustodyOverride[];
    currentUserId?: string;
  }
): "user" | "coparent" {
  if (!schedule || schedule.schedule_type === "manual") return "user";

  const rotationStart = schedule.rotation_start_date
    ? new Date(schedule.rotation_start_date)
    : null;
  const userStartsFirst = schedule.user_starts_first !== false;

  if (!rotationStart) return userStartsFirst ? "user" : "coparent";

  const daysSinceStart = daysBetween(rotationStart, date);
  const cycleLength = 14;
  const position = ((daysSinceStart % cycleLength) + cycleLength) % cycleLength;

  let firstBlock: boolean;
  switch (schedule.schedule_type) {
    case "week_on_week_off":
      firstBlock = cycleWeekOnWeekOff(position);
      break;
    case "five_two_two_five":
      firstBlock = cycleFiveTwoTwoFive(position);
      break;
    case "two_two_three":
      firstBlock = cycleTwoTwoThree(position);
      break;
    default:
      return userStartsFirst ? "user" : "coparent";
  }
  const fromRotation = firstBlock ? (userStartsFirst ? "user" : "coparent") : (userStartsFirst ? "coparent" : "user");
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  const dateStr = `${y}-${m}-${d}`;
  const userId = options?.currentUserId;

  if (options?.holidayOverrides?.length && dateStr) {
    for (const h of options.holidayOverrides) {
      if (h.start_date <= dateStr && dateStr <= h.end_date) {
        return h.custodial_parent === userId ? "user" : "coparent";
      }
    }
  }
  return fromRotation;
}

export function getCustodyOverlayDefault(
  appMode: string | null,
  hasSchedule: boolean
): boolean {
  if (!hasSchedule) return false;
  return appMode === "coparenting" || appMode === "solo_coparenting";
}

export function getStoredCustodyOverlay(
  appMode: string | null,
  hasSchedule: boolean
): boolean {
  if (typeof window === "undefined") return getCustodyOverlayDefault(appMode, hasSchedule);
  const raw = localStorage.getItem(STORAGE_KEY);
  if (raw === null) return getCustodyOverlayDefault(appMode, hasSchedule);
  return raw === "true";
}

export function setStoredCustodyOverlay(on: boolean): void {
  if (typeof window === "undefined") return;
  localStorage.setItem(STORAGE_KEY, on ? "true" : "false");
}
