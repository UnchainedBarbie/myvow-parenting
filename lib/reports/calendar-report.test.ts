import assert from "node:assert/strict";
import { buildCalendarReportPdf } from "@/lib/reports/calendar-report-pdf";
import {
  eventVisibleToViewer,
  parentingTimeForDay,
  parentingTimeLabel,
  buildCalendarReportCsv,
  prepareCalendarReport,
  type CalendarReportEvent,
  type StoredCustodySchedule,
} from "@/lib/reports/calendar-report";

const schedule: StoredCustodySchedule = {
  schedule_type: "week_on_week_off",
  rotation_start_date: "2026-03-01",
  user_starts_first: true,
  manual_pattern: null,
  updatedAt: null,
};

const base = {
  schedule,
  overrides: [],
  holidays: [],
  viewerId: "alex",
};

assert.equal(parentingTimeForDay({ ...base, dateKey: "2026-03-01" }).owner, "user");
assert.equal(parentingTimeForDay({ ...base, dateKey: "2026-03-08" }).owner, "coparent");
assert.equal(
  parentingTimeForDay({
    ...base,
    dateKey: "2026-03-02",
    overrides: [{ date: "2026-03-02", custodialParent: "coparent" }],
  }).owner,
  "coparent"
);
assert.equal(
  parentingTimeForDay({
    ...base,
    dateKey: "2026-03-03",
    holidays: [
      { name: "Spring break", startDate: "2026-03-03", endDate: "2026-03-04", custodialParent: "coparent" },
    ],
  }).owner,
  "coparent"
);

const manual: StoredCustodySchedule = {
  schedule_type: "manual",
  rotation_start_date: "2026-03-01",
  user_starts_first: true,
  manual_pattern: Array.from({ length: 14 }, () => "user"),
  updatedAt: null,
};
assert.equal(
  parentingTimeForDay({
    ...base,
    schedule: manual,
    dateKey: "2026-03-02",
    overrides: [{ date: "2026-03-02", custodialParent: "coparent" }],
  }).owner,
  "user"
);
assert.equal(
  parentingTimeForDay({ ...base, schedule: null, dateKey: "2026-03-01" }).owner,
  null
);

const span = parentingTimeLabel({
  event: {
    startTime: "2026-03-07T18:00:00.000Z",
    endTime: "2026-03-08T18:00:00.000Z",
    allDay: false,
  },
  timeZone: "America/Denver",
  schedule,
  overrides: [],
  holidays: [],
  viewerId: "alex",
  userSide: "Alex Rivera",
  otherSide: "Jordan Lee",
});
assert.match(span, /Spans more than one parent's time/);
assert.match(span, /Alex Rivera/);
assert.match(span, /Jordan Lee/);

assert.equal(
  parentingTimeLabel({
    event: { startTime: "2026-03-01T18:00:00.000Z", endTime: null, allDay: false },
    timeZone: "America/Denver",
    schedule: null,
    overrides: [],
    holidays: [],
    viewerId: "alex",
    userSide: "Alex Rivera",
    otherSide: "Jordan Lee",
  }),
  "No custody schedule is recorded"
);

assert.equal(
  eventVisibleToViewer({ visibility: "private", description: null, createdBy: "alex" }, "jordan"),
  false
);
assert.equal(
  eventVisibleToViewer({ visibility: "just_me_and_kids", description: null, createdBy: "alex" }, "jordan"),
  false
);
assert.equal(
  eventVisibleToViewer({ visibility: "family", description: null, createdBy: "alex" }, "jordan"),
  true
);

function event(partial: Partial<CalendarReportEvent> & Pick<CalendarReportEvent, "id" | "startTime">): CalendarReportEvent {
  return {
    eventNumber: 1,
    title: "Practice",
    description: null,
    eventType: "extracurricular",
    childName: "Sam",
    endTime: null,
    allDay: false,
    status: "scheduled",
    visibility: "family",
    createdBy: "alex",
    createdByName: "Alex Rivera",
    createdAt: "2026-02-01T15:00:00.000Z",
    recurringRule: null,
    isSwapRequest: false,
    swapStatus: null,
    swapOriginalMessage: null,
    actualExchangeTime: null,
    transportedBy: null,
    exchangeLocation: null,
    attachmentNames: [],
    ...partial,
  };
}

const prepared = prepareCalendarReport({
  events: [
    event({ id: "a", eventNumber: 4, startTime: "2026-03-02T18:00:00.000Z", title: "Soccer" }),
    event({
      id: "b",
      eventNumber: 9,
      startTime: "2026-01-02T18:00:00.000Z",
      title: "Old",
    }),
    event({
      id: "c",
      eventNumber: 12,
      startTime: "2026-03-05T18:00:00.000Z",
      title: "Exchange",
      eventType: "custody_exchange",
      status: "scheduled",
      childName: null,
    }),
    event({
      id: "d",
      eventNumber: 15,
      startTime: "2026-03-06T18:00:00.000Z",
      title: "Missed pickup",
      eventType: "missed_visit",
      status: "no_show",
    }),
  ],
  parents: [
    { userId: "alex", name: "Alex Rivera" },
    { userId: "jordan", name: "Jordan Lee" },
  ],
  caseLabel: "FAM-100",
  timeZone: "America/Denver",
  dateStart: "2026-03-01",
  dateEnd: "2026-03-31",
  generatedAt: new Date("2026-04-01T15:00:00.000Z"),
  viewerId: "alex",
  viewerName: "Alex Rivera",
  viewerIsParent: true,
  options: {
    custodySchedule: true,
    scheduleChanges: true,
    missedPickups: true,
    eventsByChild: true,
    monthlyCalendar: true,
    includeFiles: false,
  },
  schedule,
  overrides: [{ date: "2026-03-02", custodialParent: "coparent" }],
  holidays: [],
  withheldCount: 1,
  fieldWarning: null,
  fileLines: [],
});

assert.equal(prepared.includedCount, 3);
const eventsTable = prepared.document.blocks.find(
  (block) => block.kind === "table" && block.title === "Events"
);
assert.ok(eventsTable && eventsTable.kind === "table");
assert.equal(eventsTable.headers[0], "Event ID");
assert.equal(eventsTable.headers[7], "Created by");
assert.equal(eventsTable.headers[8], "Created on");
assert.equal(eventsTable.headers[9], "Parenting time");
assert.equal(eventsTable.rows[0][0], "EVT-004");
assert.equal(eventsTable.rows[0][7], "Alex Rivera");
assert.match(eventsTable.rows[0][9], /Jordan Lee/);
assert.equal(eventsTable.widths.reduce((sum, width) => sum + width, 0), 255.4);

const missed = prepared.document.blocks.find(
  (block) => block.kind === "table" && block.title === "Missed pickups and dropoffs"
);
assert.ok(missed && missed.kind === "table");
assert.equal(missed.rows.length, 1);
assert.equal(missed.rows[0][0], "EVT-015");

const exchanges = prepared.document.blocks.find((block) => block.kind === "table" && block.title === "Exchanges");
assert.ok(exchanges && exchanges.kind === "table");
assert.equal(exchanges.rows.length, 1);
assert.equal(exchanges.rows[0][5], "Not recorded");

const month = prepared.document.blocks.find((block) => block.kind === "month");
assert.ok(month && month.kind === "month");
assert.equal(month.title, "March 2026");

const withoutGrid = prepareCalendarReport({
  events: [event({ id: "a", eventNumber: 4, startTime: "2026-03-02T18:00:00.000Z", title: "Soccer" })],
  parents: [
    { userId: "alex", name: "Alex Rivera" },
    { userId: "jordan", name: "Jordan Lee" },
  ],
  caseLabel: "FAM-100",
  timeZone: "America/Denver",
  dateStart: "2026-03-01",
  dateEnd: "2026-03-31",
  generatedAt: new Date("2026-04-01T15:00:00.000Z"),
  viewerId: "alex",
  viewerName: "Alex Rivera",
  viewerIsParent: true,
  options: {
    custodySchedule: false,
    scheduleChanges: false,
    missedPickups: false,
    eventsByChild: true,
    monthlyCalendar: false,
    includeFiles: false,
  },
  schedule,
  overrides: [],
  holidays: [],
  withheldCount: 0,
  fieldWarning: null,
  fileLines: [],
});
assert.equal(withoutGrid.document.blocks.some((block) => block.kind === "month"), false);
const tableOnly = withoutGrid.document.blocks.find((block) => block.kind === "table" && block.title === "Events");
assert.ok(tableOnly && tableOnly.kind === "table");
assert.equal(tableOnly.rows[0]?.[0], "EVT-004");
assert.doesNotMatch(withoutGrid.document.facts.map((fact) => fact.value).join(" "), /Monthly calendars/);
const listed = prepareCalendarReport({
  events: [event({ id: "a", eventNumber: 4, startTime: "2026-03-02T18:00:00.000Z", title: "Soccer", attachmentNames: ["soccer.pdf"] })],
  parents: [
    { userId: "alex", name: "Alex Rivera" },
    { userId: "jordan", name: "Jordan Lee" },
  ],
  caseLabel: "FAM-100",
  timeZone: "America/Denver",
  dateStart: "2026-03-01",
  dateEnd: "2026-03-31",
  generatedAt: new Date("2026-04-01T15:00:00.000Z"),
  viewerId: "alex",
  viewerName: "Alex Rivera",
  viewerIsParent: true,
  options: {
    custodySchedule: false,
    scheduleChanges: false,
    missedPickups: false,
    eventsByChild: false,
    monthlyCalendar: false,
    includeFiles: false,
  },
  schedule,
  overrides: [],
  holidays: [],
  withheldCount: 0,
  fieldWarning: null,
  fileLines: [],
  listEvidence: true,
});
const calendarCsv = buildCalendarReportCsv(listed.document);
assert.match(calendarCsv, /Event ID,Title/);
assert.match(calendarCsv, /EVT-004/);
assert.match(calendarCsv, /No document ID stored \| soccer\.pdf \| Stored with the event/);
assert.doesNotMatch(calendarCsv, /\bpp?\./);

assert.match(prepared.document.completeness, /1 event is omitted/);
assert.match(prepared.verificationPayload, /EVT|a~4/);

const pdf = buildCalendarReportPdf(prepared.document, "FAM-100", prepared.verificationPayload);
assert.match(Buffer.from(pdf.buffer).toString("latin1"), /MediaBox \[0 0 792\.? 612\.?\]/);
assert.ok(pdf.pageCount >= 2);

console.log(`calendar report tests passed (${pdf.pageCount} pages)`);
