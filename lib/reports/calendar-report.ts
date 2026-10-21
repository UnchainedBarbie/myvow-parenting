import { getCustodyFromRotation, type CustodySchedule } from "@/lib/calendarCustody";
import { formatDateSpan, zonedDayEndMs, zonedDayStartMs } from "@/lib/record/record-filters";

export const CALENDAR_CATEGORY_LABELS: Record<string, string> = {
  medical: "Medical",
  school: "School",
  extracurricular: "Extracurricular",
  custody_exchange: "Custody exchange",
  therapy: "Therapy",
  missed_visit: "Missed visit",
  conflict: "Conflict",
  other: "Other",
  swap_request: "Schedule change",
  custody: "Custody",
};

export const CALENDAR_STATUS_LABELS: Record<string, string> = {
  scheduled: "Scheduled",
  completed: "Completed",
  no_show: "No-show",
  conflict: "Conflict",
  canceled: "Canceled",
};

export const CALENDAR_VISIBILITY_LABELS: Record<string, string> = {
  family: "Family",
  family_read_only: "Family",
  parents_only: "Parents only",
  just_me_and_kids: "Just me and kids",
  private: "Visible only to me",
};

export type CalendarReportOptions = {
  custodySchedule: boolean;
  scheduleChanges: boolean;
  missedPickups: boolean;
  eventsByChild: boolean;
  includeFiles: boolean;
};

export type CalendarSide = "user" | "coparent" | "neither";

export type CalendarReportEvent = {
  id: string;
  eventNumber: number | null;
  title: string;
  description: string | null;
  eventType: string | null;
  childName: string | null;
  startTime: string;
  endTime: string | null;
  allDay: boolean;
  status: string | null;
  visibility: string | null;
  createdBy: string | null;
  createdByName: string | null;
  createdAt: string | null;
  recurringRule: string | null;
  isSwapRequest: boolean;
  swapStatus: string | null;
  swapOriginalMessage: string | null;
  actualExchangeTime: string | null;
  transportedBy: string | null;
  exchangeLocation: string | null;
  attachmentNames: string[];
};

export type HolidayAssignment = {
  name: string;
  startDate: string;
  endDate: string;
  custodialParent: string;
};

export type DayOverride = {
  date: string;
  custodialParent: string;
};

export type StoredCustodySchedule = CustodySchedule & {
  updatedAt: string | null;
};

export type CalendarFact = { label: string; value: string };
export type CalendarTable = {
  kind: "table";
  title: string;
  intro?: string;
  headers: string[];
  widths: number[];
  rows: string[][];
  empty: string;
};
export type CalendarLines = { kind: "lines"; title: string; lines: string[] };
export type CalendarMonthCell = {
  day: number | null;
  label: string;
  events: string[];
  more: number;
  owner: CalendarSide | null;
};
export type CalendarMonth = {
  kind: "month";
  title: string;
  weeks: CalendarMonthCell[][];
};
export type CalendarBlock = CalendarTable | CalendarLines | CalendarMonth;

export type CalendarReportDocument = {
  facts: CalendarFact[];
  blocks: CalendarBlock[];
  completeness: string;
  verificationExplanation: string;
};

const MAX_MONTHS = 18;
const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export function calendarReportOptions(options: Record<string, boolean> | undefined): CalendarReportOptions {
  const on = (key: string) => options?.[key] !== false;
  return {
    custodySchedule: on("custody_schedule"),
    scheduleChanges: on("schedule_changes"),
    missedPickups: on("missed_pickups"),
    eventsByChild: on("events_by_child"),
    includeFiles: options?.include_event_files === true,
  };
}

export function formatEventNumber(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return "—";
  return `EVT-${String(Math.trunc(value)).padStart(3, "0")}`;
}

export function calendarCategoryLabel(value: string | null | undefined): string {
  const key = value?.trim() ?? "";
  if (!key) return "Event";
  return CALENDAR_CATEGORY_LABELS[key] ?? key;
}

export function calendarStatusLabel(value: string | null | undefined): string {
  const key = (value ?? "scheduled").trim().toLowerCase();
  if (key === "completed" || key === "no_show" || key === "conflict" || key === "canceled") {
    return CALENDAR_STATUS_LABELS[key];
  }
  return "Scheduled";
}

export function calendarVisibilityLabel(value: string | null | undefined, legacyPrivate: boolean): string {
  const key = value?.trim().toLowerCase() ?? "";
  if (key && CALENDAR_VISIBILITY_LABELS[key]) return CALENDAR_VISIBILITY_LABELS[key];
  if (!key && legacyPrivate) return "Visible only to me";
  if (!key) return "Family";
  return value?.trim() || "Family";
}

/** Same visibility gate as the Calendar tab. */
export function eventVisibleToViewer(
  event: { visibility: string | null; description: string | null; createdBy: string | null },
  viewerId: string
): boolean {
  const visibility = event.visibility?.trim().toLowerCase() ?? "";
  const legacyPrivate = !visibility && (event.description?.startsWith("[PRIVATE]") ?? false);
  if (visibility === "private" || visibility === "just_me_and_kids" || legacyPrivate) {
    return event.createdBy === viewerId;
  }
  return true;
}

export function eventDescriptionForReport(description: string | null, visibility: string | null): string {
  if (!visibility?.trim() && description?.startsWith("[PRIVATE]")) {
    return description.replace(/^\[PRIVATE\]\s*/, "").trim();
  }
  return description?.trim() ?? "";
}

export function zonedDateKey(iso: string, timeZone: string): string | null {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const year = parts.find((part) => part.type === "year")?.value;
  const month = parts.find((part) => part.type === "month")?.value;
  const day = parts.find((part) => part.type === "day")?.value;
  if (!year || !month || !day) return null;
  return `${year}-${month}-${day}`;
}

function shiftDateKey(key: string, days: number): string {
  const [year, month, day] = key.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day + days));
  return date.toISOString().slice(0, 10);
}

export function eventDateKeys(
  event: { startTime: string; endTime: string | null; allDay: boolean },
  timeZone: string
): string[] {
  const startKey = zonedDateKey(event.startTime, timeZone);
  if (!startKey) return [];
  if (!event.endTime) return [startKey];
  const endKey = zonedDateKey(event.endTime, timeZone);
  if (!endKey) return [startKey];
  let last = endKey;
  if (!event.allDay && endKey !== startKey) {
    const endMs = new Date(event.endTime).getTime();
    if (endMs <= zonedDayStartMs(endKey, timeZone)) last = shiftDateKey(endKey, -1);
  }
  if (last < startKey) return [startKey];
  const keys: string[] = [];
  let cursor = startKey;
  for (let i = 0; i < 370 && cursor <= last; i += 1) {
    keys.push(cursor);
    cursor = shiftDateKey(cursor, 1);
  }
  return keys;
}

function recognizedSchedule(schedule: StoredCustodySchedule | null): CustodySchedule | null {
  if (!schedule?.schedule_type?.trim()) return null;
  const type = schedule.schedule_type.trim();
  const known = [
    "seven_seven",
    "7/7",
    "week_on_week_off",
    "five_two_two_five",
    "5/2/2/5",
    "two_two_three",
    "2/2/3",
    "manual",
  ].includes(type);
  return {
    schedule_type: known ? type : "manual",
    rotation_start_date: schedule.rotation_start_date,
    user_starts_first: schedule.user_starts_first,
    manual_pattern: schedule.manual_pattern ?? null,
  };
}

function mapParentToken(
  value: string,
  viewerId: string
): CalendarSide | "unknown" {
  const token = value.trim();
  if (token === viewerId || token === "user") return "user";
  if (token === "coparent") return "coparent";
  if (token === "neither") return "neither";
  return "unknown";
}

/**
 * Parenting time for one calendar day.
 * Matches the Calendar tab: rotation, then a day override unless the schedule is custom.
 * A recorded holiday assignment replaces that result because the calendar draws it as that parent's time.
 */
export function parentingTimeForDay(input: {
  dateKey: string;
  schedule: StoredCustodySchedule | null;
  overrides: DayOverride[];
  holidays: HolidayAssignment[];
  viewerId: string;
}): { owner: CalendarSide | null; holidayName: string | null; unrecognized: boolean } {
  const schedule = recognizedSchedule(input.schedule);
  const [year, month, day] = input.dateKey.split("-").map(Number);
  const date = new Date(year, month - 1, day);
  let owner: CalendarSide | null = null;
  if (schedule) {
    const manual = schedule.schedule_type === "manual";
    if (!manual) {
      const override = input.overrides.find((item) => item.date.slice(0, 10) === input.dateKey);
      if (override) {
        const mapped = mapParentToken(override.custodialParent, input.viewerId);
        if (mapped === "unknown") return { owner: null, holidayName: null, unrecognized: true };
        owner = mapped;
      }
    }
    if (!owner) {
      const rotation = getCustodyFromRotation(date, schedule);
      owner = rotation;
    }
  }
  const holiday = input.holidays.find(
    (item) => item.startDate.slice(0, 10) <= input.dateKey && input.dateKey <= item.endDate.slice(0, 10)
  );
  if (holiday) {
    const mapped = mapParentToken(holiday.custodialParent, input.viewerId);
    if (mapped === "unknown") return { owner, holidayName: holiday.name, unrecognized: true };
    return { owner: mapped, holidayName: holiday.name, unrecognized: false };
  }
  return { owner, holidayName: null, unrecognized: false };
}

export function sideName(side: CalendarSide | null, userSide: string, otherSide: string): string {
  if (side === "user") return userSide;
  if (side === "coparent") return otherSide;
  if (side === "neither") return "No parent scheduled";
  return "Not recorded";
}

export function parentingTimeLabel(input: {
  event: Pick<CalendarReportEvent, "startTime" | "endTime" | "allDay">;
  timeZone: string;
  schedule: StoredCustodySchedule | null;
  overrides: DayOverride[];
  holidays: HolidayAssignment[];
  viewerId: string;
  userSide: string;
  otherSide: string;
}): string {
  const keys = eventDateKeys(input.event, input.timeZone);
  if (keys.length === 0) return "Not recorded";
  if (!input.schedule && input.holidays.length === 0 && input.overrides.length === 0) {
    return "No custody schedule is recorded";
  }
  const parts = keys.map((key) => {
    const result = parentingTimeForDay({
      dateKey: key,
      schedule: input.schedule,
      overrides: input.overrides,
      holidays: input.holidays,
      viewerId: input.viewerId,
    });
    const name = result.unrecognized
      ? "Recorded parent is not one of the parents on this case"
      : sideName(result.owner, input.userSide, input.otherSide);
    const holiday = result.holidayName ? ` (${result.holidayName})` : "";
    return keys.length === 1 ? `${name}${holiday}` : `${formatDay(key)} ${name}${holiday}`;
  });
  const owners = new Set(
    keys.map((key) =>
      parentingTimeForDay({
        dateKey: key,
        schedule: input.schedule,
        overrides: input.overrides,
        holidays: input.holidays,
        viewerId: input.viewerId,
      }).owner
    )
  );
  if (keys.length > 1 && owners.size > 1) {
    return `Spans more than one parent's time: ${parts.join("; ")}`;
  }
  return parts.join("; ");
}

function formatDay(key: string): string {
  const [year, month, day] = key.split("-").map(Number);
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  }).format(new Date(Date.UTC(year, month - 1, day)));
}

function formatWhen(event: CalendarReportEvent, timeZone: string): string {
  const start = new Date(event.startTime);
  if (Number.isNaN(start.getTime())) return "—";
  const date = new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone,
  }).format(start);
  if (event.allDay) return `${date}, all day`;
  const time = new Intl.DateTimeFormat("en-US", {
    hour: "numeric",
    minute: "2-digit",
    timeZone,
  }).format(start);
  if (!event.endTime) return `${date}, ${time}`;
  const end = new Date(event.endTime);
  if (Number.isNaN(end.getTime())) return `${date}, ${time}`;
  const endTime = new Intl.DateTimeFormat("en-US", {
    hour: "numeric",
    minute: "2-digit",
    timeZone,
  }).format(end);
  const endKey = zonedDateKey(event.endTime, timeZone);
  const startKey = zonedDateKey(event.startTime, timeZone);
  if (endKey && startKey && endKey !== startKey) {
    const endDate = new Intl.DateTimeFormat("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
      timeZone,
    }).format(end);
    return `${date}, ${time} – ${endDate}, ${endTime}`;
  }
  return `${date}, ${time}–${endTime}`;
}

function formatStamp(iso: string | null, timeZone: string): string {
  if (!iso) return "Not recorded";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "Not recorded";
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short",
    timeZone,
  }).format(date);
}

function scheduleTypeLabel(type: string): string {
  const key = type.trim();
  if (key === "week_on_week_off" || key === "seven_seven" || key === "7/7") return "Week on, week off";
  if (key === "five_two_two_five" || key === "5/2/2/5") return "5/2/2/5";
  if (key === "two_two_three" || key === "2/2/3") return "2/2/3";
  if (key === "manual") return "Custom pattern";
  if (key === "school_year") return "School year";
  return key;
}

function dayKey(value: string | null): string | null {
  if (!value) return null;
  const match = /^(\d{4}-\d{2}-\d{2})/.exec(value.trim());
  return match ? match[1] : null;
}

function inDateRange(iso: string, from: string | null, to: string | null, timeZone: string): boolean {
  const key = zonedDateKey(iso, timeZone);
  if (!key) return false;
  if (from && key < from) return false;
  if (to && key > to) return false;
  return true;
}

function monthsBetween(from: string, to: string): { year: number; month: number }[] {
  const start = from <= to ? from : to;
  const end = from <= to ? to : from;
  const [sy, sm] = start.split("-").map(Number);
  const [ey, em] = end.split("-").map(Number);
  const months: { year: number; month: number }[] = [];
  let year = sy;
  let month = sm;
  while (year < ey || (year === ey && month <= em)) {
    months.push({ year, month });
    month += 1;
    if (month === 13) {
      month = 1;
      year += 1;
    }
    if (months.length > 36) break;
  }
  return months;
}

export function buildMonthGrid(input: {
  year: number;
  month: number;
  events: CalendarReportEvent[];
  timeZone: string;
  schedule: StoredCustodySchedule | null;
  overrides: DayOverride[];
  holidays: HolidayAssignment[];
  viewerId: string;
  userSide: string;
  otherSide: string;
}): CalendarMonth {
  const first = new Date(input.year, input.month - 1, 1);
  const daysInMonth = new Date(input.year, input.month, 0).getDate();
  const cells: CalendarMonthCell[] = [];
  for (let i = 0; i < first.getDay(); i += 1) {
    cells.push({ day: null, label: "", events: [], more: 0, owner: null });
  }
  for (let day = 1; day <= daysInMonth; day += 1) {
    const key = `${input.year}-${String(input.month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    const result = parentingTimeForDay({
      dateKey: key,
      schedule: input.schedule,
      overrides: input.overrides,
      holidays: input.holidays,
      viewerId: input.viewerId,
    });
    const names = input.events
      .filter((event) => zonedDateKey(event.startTime, input.timeZone) === key)
      .map((event) => event.title.trim() || "Untitled");
    const short =
      result.owner === "user"
        ? input.userSide
        : result.owner === "coparent"
          ? input.otherSide
          : result.owner === "neither"
            ? "None"
            : "";
    cells.push({
      day,
      label: result.holidayName ? `${short || "Holiday"} · ${result.holidayName}` : short,
      events: names.slice(0, 3),
      more: Math.max(0, names.length - 3),
      owner: result.owner,
    });
  }
  while (cells.length % 7 !== 0) cells.push({ day: null, label: "", events: [], more: 0, owner: null });
  const weeks: CalendarMonthCell[][] = [];
  for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7));
  const title = new Intl.DateTimeFormat("en-US", { month: "long", year: "numeric", timeZone: "UTC" }).format(
    new Date(Date.UTC(input.year, input.month - 1, 1))
  );
  return { kind: "month", title, weeks };
}

export function prepareCalendarReport(input: {
  events: CalendarReportEvent[];
  parents: { userId: string | null; name: string }[];
  caseLabel: string;
  timeZone: string;
  dateStart: string | null;
  dateEnd: string | null;
  generatedAt: Date;
  viewerId: string;
  viewerName: string;
  viewerIsParent: boolean;
  options: CalendarReportOptions;
  schedule: StoredCustodySchedule | null;
  overrides: DayOverride[];
  holidays: HolidayAssignment[];
  withheldCount: number;
  fieldWarning: string | null;
  fileLines: string[];
}): { includedCount: number; verificationPayload: string; document: CalendarReportDocument } {
  const from = dayKey(input.dateStart);
  const to = dayKey(input.dateEnd);
  const included = input.events
    .filter((event) => inDateRange(event.startTime, from, to, input.timeZone))
    .sort((a, b) => (a.startTime < b.startTime ? -1 : a.startTime > b.startTime ? 1 : a.id < b.id ? -1 : 1));

  const other = input.parents.find((parent) => parent.userId && parent.userId !== input.viewerId);
  const userSide = input.viewerIsParent
    ? input.viewerName.trim() || "The parent who generated this report"
    : "The parent recorded as Me";
  const otherSide = input.viewerIsParent
    ? other?.name?.trim() || "Co-parent"
    : "Co-parent";

  const generatedLabel = new Intl.DateTimeFormat("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short",
    timeZone: input.timeZone,
  }).format(input.generatedAt);
  const dateLabel = !from && !to
    ? "All dates"
    : from && to
      ? formatDateSpan(from <= to ? from : to, from <= to ? to : from)
      : from
        ? `On or after ${formatDateSpan(from, from)}`
        : `On or before ${formatDateSpan(to as string, to as string)}`;

  const sectionNames: string[] = ["Monthly calendars"];
  if (input.options.custodySchedule) sectionNames.push("Custody schedule");
  if (input.options.scheduleChanges) sectionNames.push("Schedule changes");
  if (input.options.eventsByChild) sectionNames.push("Events");
  if (input.options.missedPickups) sectionNames.push("Missed pickups and dropoffs");
  if (input.options.includeFiles) sectionNames.push("Event attachments");

  const blocks: CalendarBlock[] = [];
  const monthSource = from && to ? monthsBetween(from, to) : monthsFromEvents(included, input.timeZone);
  const shownMonths = monthSource.slice(0, MAX_MONTHS);
  if (monthSource.length > MAX_MONTHS) {
    blocks.push({
      kind: "lines",
      title: "Monthly calendars",
      lines: [
        `This range covers ${monthSource.length} months. The first ${MAX_MONTHS} months are shown as calendars. Every included event is still listed in the table.`,
      ],
    });
  }
  for (const month of shownMonths) {
    blocks.push(
      buildMonthGrid({
        year: month.year,
        month: month.month,
        events: included,
        timeZone: input.timeZone,
        schedule: input.schedule,
        overrides: input.overrides,
        holidays: input.holidays,
        viewerId: input.viewerId,
        userSide,
        otherSide,
      })
    );
  }
  if (shownMonths.length === 0) {
    blocks.push({
      kind: "lines",
      title: "Monthly calendars",
      lines: ["No dates were selected and no events are available, so there is no month to print."],
    });
  }

  if (input.options.custodySchedule) {
    blocks.push({
      kind: "lines",
      title: "Custody schedule",
      lines: scheduleLines(input, userSide, otherSide, from, to),
    });
  }
  if (input.options.scheduleChanges) {
    blocks.push({
      kind: "table",
      title: "Schedule changes",
      intro:
        "Only stored swap requests and day overrides are listed. Saving a new custody pattern replaces the previous pattern; earlier patterns are not kept.",
      headers: ["Date", "Record", "Assigned time", "Status", "Details"],
      widths: [36, 48, 52, 36, 83.4],
      rows: changeRows(included, input, userSide, otherSide, from, to),
      empty: "No schedule changes or swap requests are recorded for these dates.",
    });
  }
  if (input.options.eventsByChild) {
    const counts = childCounts(included);
    blocks.push({
      kind: "lines",
      title: "Events by child",
      lines: counts.length > 0 ? counts : ["No events are included."],
    });
    blocks.push({
      kind: "table",
      title: "Events",
      intro: "Listed by start time, matching the Calendar list. Event numbers stay with the original record.",
      headers: [
        "Event ID",
        "Title",
        "Date/time",
        "Child",
        "Category",
        "Status",
        "Description",
        "Created by",
        "Created on",
        "Parenting time",
        "Visibility",
        "Attachments",
      ],
      widths: [16, 26, 28, 16, 18, 16, 22, 20, 22, 30, 18, 23.4],
      rows: included.map((event) => eventRow(event, input, userSide, otherSide)),
      empty: "No events start in the selected dates.",
    });
    const exchanges = included.filter((event) => event.eventType === "custody_exchange");
    blocks.push({
      kind: "table",
      title: "Exchanges",
      intro: "Custody exchange events only. A past date is not treated as a completed exchange unless that status is stored.",
      headers: ["Event ID", "Title", "Date/time", "Child", "Status", "Actual time", "Transported by", "Location"],
      widths: [22, 40, 40, 28, 24, 28, 36, 37.4],
      rows: exchanges.map((event) => [
        formatEventNumber(event.eventNumber),
        event.title.trim() || "Untitled",
        formatWhen(event, input.timeZone),
        event.childName?.trim() || "All children",
        calendarStatusLabel(event.status),
        event.actualExchangeTime?.trim() || "Not recorded",
        event.transportedBy?.trim() || "Not recorded",
        event.exchangeLocation?.trim() || "Not recorded",
      ]),
      empty: "No custody exchanges are recorded in the selected dates.",
    });
  }
  if (input.options.missedPickups) {
    const missed = included.filter(
      (event) => event.status?.trim().toLowerCase() === "no_show" || event.eventType === "missed_visit"
    );
    blocks.push({
      kind: "table",
      title: "Missed pickups and dropoffs",
      intro: "Only events stored as No-show or Missed visit. Missed exchanges are not inferred from the schedule.",
      headers: ["Event ID", "Title", "Date/time", "Child", "Status", "Description", "Created by"],
      widths: [22, 46, 42, 28, 24, 52, 41.4],
      rows: missed.map((event) => [
        formatEventNumber(event.eventNumber),
        event.title.trim() || "Untitled",
        formatWhen(event, input.timeZone),
        event.childName?.trim() || "All children",
        calendarStatusLabel(event.status),
        eventDescriptionForReport(event.description, event.visibility) || "—",
        event.createdByName?.trim() || "Not recorded",
      ]),
      empty: "No missed pickups or dropoffs are recorded in the selected dates.",
    });
  }
  if (input.options.includeFiles) {
    blocks.push({
      kind: "lines",
      title: "Event attachments",
      lines:
        input.fileLines.length > 0
          ? [
              "Files follow this report in event order. Each file is labeled with its event number. Email text stored with an event is included below.",
              ...input.fileLines,
            ]
          : ["No event attachments are stored for the included events."],
    });
  }
  if (input.fieldWarning) {
    blocks.push({ kind: "lines", title: "Record fields", lines: [input.fieldWarning] });
  }

  const withheld =
    input.withheldCount === 0
      ? "No events were withheld."
      : `${input.withheldCount} event${input.withheldCount === 1 ? "" : "s"} ${input.withheldCount === 1 ? "is" : "are"} omitted because ${input.withheldCount === 1 ? "it is" : "they are"} visible only to the parent who created ${input.withheldCount === 1 ? "it" : "them"}.`;

  const payload = included.map((event) =>
    [event.id, event.eventNumber ?? "", event.startTime, event.status ?? "", event.createdBy ?? ""].join("~")
  );

  return {
    includedCount: included.length,
    verificationPayload: payload.join("|"),
    document: {
      facts: [
        { label: "Case", value: input.caseLabel || "Not recorded" },
        {
          label: "Parties",
          value: input.parents.length > 0 ? input.parents.map((parent) => parent.name).join("; ") : "Not recorded",
        },
        { label: "Date range", value: `${dateLabel}. Events are included by their start date.` },
        { label: "Generated", value: generatedLabel },
        { label: "Sections", value: sectionNames.join("; ") },
      ],
      blocks,
      completeness: `This report includes ${included.length} event${included.length === 1 ? "" : "s"} that start in the selected dates and that this person is allowed to see on the Calendar tab. ${withheld}`,
      verificationExplanation:
        "This SHA-256 hash is computed from the included event identifiers, numbers, start times, statuses, and creating parents. It can be compared with a later export of the same records. It is not an independent certification.",
    },
  };
}

function monthsFromEvents(events: CalendarReportEvent[], timeZone: string): { year: number; month: number }[] {
  const seen = new Set<string>();
  const months: { year: number; month: number }[] = [];
  for (const event of events) {
    const key = zonedDateKey(event.startTime, timeZone);
    if (!key) continue;
    const id = key.slice(0, 7);
    if (seen.has(id)) continue;
    seen.add(id);
    const [year, month] = id.split("-").map(Number);
    months.push({ year, month });
  }
  return months;
}

function scheduleLines(
  input: {
    schedule: StoredCustodySchedule | null;
    overrides: DayOverride[];
    holidays: HolidayAssignment[];
    timeZone: string;
    viewerId: string;
  },
  userSide: string,
  otherSide: string,
  from: string | null,
  to: string | null
): string[] {
  if (!input.schedule) {
    return ["No custody schedule is recorded for this case."];
  }
  const type = input.schedule.schedule_type?.trim() || "Not recorded";
  const known = [
    "seven_seven",
    "7/7",
    "week_on_week_off",
    "five_two_two_five",
    "5/2/2/5",
    "two_two_three",
    "2/2/3",
    "manual",
    "school_year",
  ].includes(type);
  const lines = [
    `Schedule type: ${scheduleTypeLabel(type)}.`,
    input.schedule.rotation_start_date
      ? `Pattern starts ${input.schedule.rotation_start_date.slice(0, 10)}.`
      : "No pattern start date is recorded.",
    input.schedule.user_starts_first === false
      ? `The saved pattern starts with ${otherSide}.`
      : input.schedule.user_starts_first === true
        ? `The saved pattern starts with ${userSide}.`
        : "The schedule does not record who starts the pattern.",
    "The Calendar tab calls the Me side of this pattern “you” for the person viewing it. This report names that side for the parent who generated the report when that person is a parent on the case. The schedule does not store which account pressed Me.",
    "Earlier versions of this schedule are not stored. The pattern below is the one currently saved.",
  ];
  if (!known) {
    lines.push("This schedule type is not one of the Calendar patterns, so the Calendar tab treats it as a custom pattern.");
  }
  if (input.schedule.schedule_type === "manual" && Array.isArray(input.schedule.manual_pattern)) {
    const pattern = input.schedule.manual_pattern
      .map((day) => sideName(day === "user" || day === "coparent" || day === "neither" ? day : null, userSide, otherSide))
      .join(", ");
    lines.push(`Custom pattern: ${pattern}.`);
  }
  if (input.schedule.schedule_type === "manual" && input.overrides.length > 0) {
    lines.push("Day overrides are stored, and the Calendar tab does not apply them to a custom pattern.");
  }
  const holidays = input.holidays.filter((holiday) => rangesOverlap(holiday.startDate, holiday.endDate, from, to));
  if (holidays.length === 0) lines.push("No holiday parenting time is recorded for these dates.");
  else {
    lines.push(
      ...holidays.map((holiday) => {
        const mapped = mapParentToken(holiday.custodialParent, input.viewerId);
        const who =
          mapped === "unknown" ? "a parent who could not be matched to this case" : sideName(mapped, userSide, otherSide);
        return `${holiday.name}: ${holiday.startDate.slice(0, 10)} to ${holiday.endDate.slice(0, 10)}, ${who}.`;
      })
    );
  }
  return lines;
}

function rangesOverlap(start: string, end: string, from: string | null, to: string | null): boolean {
  const a = start.slice(0, 10);
  const b = end.slice(0, 10);
  if (to && a > to) return false;
  if (from && b < from) return false;
  return true;
}

function changeRows(
  events: CalendarReportEvent[],
  input: {
    overrides: DayOverride[];
    timeZone: string;
    viewerId: string;
    schedule: StoredCustodySchedule | null;
  },
  userSide: string,
  otherSide: string,
  from: string | null,
  to: string | null
): string[][] {
  const rows: string[][] = [];
  const manual = input.schedule?.schedule_type === "manual";
  if (!manual) {
    for (const override of input.overrides) {
      const date = override.date.slice(0, 10);
      if (from && date < from) continue;
      if (to && date > to) continue;
      const mapped = mapParentToken(override.custodialParent, input.viewerId);
      rows.push([
        formatDay(date),
        "Day override",
        mapped === "unknown" ? "Recorded parent is not one of the parents on this case" : sideName(mapped, userSide, otherSide),
        "Recorded",
        "Replaces the rotation for this date on the Calendar tab.",
      ]);
    }
  }
  for (const event of events) {
    if (!event.isSwapRequest && event.eventType !== "swap_request" && !event.swapStatus) continue;
    rows.push([
      formatWhen(event, input.timeZone),
      formatEventNumber(event.eventNumber),
      event.title.trim() || "Schedule change",
      event.swapStatus?.trim() || calendarStatusLabel(event.status),
      event.swapOriginalMessage?.trim() || eventDescriptionForReport(event.description, event.visibility) || "—",
    ]);
  }
  return rows;
}

function childCounts(events: CalendarReportEvent[]): string[] {
  const counts = new Map<string, number>();
  for (const event of events) {
    const name = event.childName?.trim() || "All children";
    counts.set(name, (counts.get(name) ?? 0) + 1);
  }
  return [...counts.entries()].map(([name, count]) => `${name}: ${count} event${count === 1 ? "" : "s"}.`);
}

function eventRow(
  event: CalendarReportEvent,
  input: {
    timeZone: string;
    schedule: StoredCustodySchedule | null;
    overrides: DayOverride[];
    holidays: HolidayAssignment[];
    viewerId: string;
  },
  userSide: string,
  otherSide: string
): string[] {
  const description = eventDescriptionForReport(event.description, event.visibility);
  const recurring = event.recurringRule?.trim() ? ` Repeats: ${event.recurringRule.trim()}.` : "";
  return [
    formatEventNumber(event.eventNumber),
    event.title.trim() || "Untitled",
    formatWhen(event, input.timeZone),
    event.childName?.trim() || "All children",
    calendarCategoryLabel(event.eventType),
    calendarStatusLabel(event.status),
    `${description || "—"}${recurring}`,
    event.createdByName?.trim() || "Not recorded",
    formatStamp(event.createdAt, input.timeZone),
    parentingTimeLabel({
      event,
      timeZone: input.timeZone,
      schedule: input.schedule,
      overrides: input.overrides,
      holidays: input.holidays,
      viewerId: input.viewerId,
      userSide,
      otherSide,
    }),
    calendarVisibilityLabel(event.visibility, false),
    event.attachmentNames.length > 0 ? event.attachmentNames.join("; ") : "—",
  ];
}

export const CALENDAR_WEEKDAYS = WEEKDAYS;

export function eventInRangeStart(iso: string, from: string | null, to: string | null, timeZone: string): boolean {
  if (!from && !to) return true;
  const ms = new Date(iso).getTime();
  if (Number.isNaN(ms)) return false;
  if (from && ms < zonedDayStartMs(from, timeZone)) return false;
  if (to && ms > zonedDayEndMs(to, timeZone)) return false;
  return true;
}
