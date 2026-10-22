import assert from "node:assert/strict";
import {
  buildCalendarNotice,
  calendarChangeLabels,
  calendarNoticeHref,
  calendarNoticeLink,
  defaultNotifyCoparent,
  effectiveNotifyCoparent,
  noticeFingerprint,
  noticeLocation,
  planCalendarNotice,
  readCalendarEventRef,
  viewerCanOpenCalendarEvent,
  withCalendarEventRef,
} from "@/lib/calendar/coparent-notice";
import { eventSubjectFromTexts, resolveEventSubject } from "@/lib/sage/event-subject";

assert.equal(defaultNotifyCoparent("family"), true);
assert.equal(defaultNotifyCoparent("parents_only"), true);
assert.equal(defaultNotifyCoparent("family_read_only"), true);
assert.equal(defaultNotifyCoparent("private"), false);
assert.equal(defaultNotifyCoparent("just_me_and_kids"), false);

assert.equal(effectiveNotifyCoparent("family", null), true);
assert.equal(effectiveNotifyCoparent("family", false), false);
assert.equal(effectiveNotifyCoparent("parents_only", true), true);
assert.equal(effectiveNotifyCoparent("private", true), false);
assert.equal(effectiveNotifyCoparent("just_me_and_kids", true), false);
assert.equal(effectiveNotifyCoparent("family", true), true);

const secret = "Private counseling note that must stay hidden";
const hidden = buildCalendarNotice({
  eventId: "event-1",
  visibility: "private",
  choice: true,
  title: "Ashley — Orthodontist Appointment",
  kind: "created",
  location: secret,
  start: "2026-10-22T21:30:00.000Z",
  end: null,
});
assert.equal(hidden, null);

const kidsOnly = planCalendarNotice({
  eventId: "event-1",
  visibility: "just_me_and_kids",
  choice: true,
  title: "Ashley — Orthodontist Appointment",
  kind: "created",
  location: secret,
  start: "2026-10-22T21:30:00.000Z",
  end: null,
  actorId: "parent-1",
  members: [{ userId: "parent-2", participating: true }],
  alreadySent: false,
});
assert.equal(kidsOnly.status, "skipped");
assert.equal(kidsOnly.notice, null);
assert.deepEqual(kidsOnly.recipientIds, []);

const created = planCalendarNotice({
  eventId: "event-1",
  visibility: "family",
  choice: null,
  title: "Ashley — Orthodontist Appointment",
  kind: "created",
  location: "Smile Orthodontics",
  start: "2026-10-22T21:30:00.000Z",
  end: "2026-10-22T22:00:00.000Z",
  actorId: "parent-1",
  members: [
    { userId: "parent-1", participating: true },
    { userId: "parent-2", participating: true },
    { invited: true, participating: true },
  ],
  alreadySent: false,
});
assert.equal(created.status, "sent");
assert.deepEqual(created.recipientIds, ["parent-2"]);
assert.equal(created.pendingInvite, true);
assert.equal(created.notice?.type, "calendar_event");
assert.match(created.notice?.message ?? "", /Ashley — Orthodontist Appointment/);
assert.match(created.notice?.message ?? "", /Thu, Oct 22, 3:30 PM–4:00 PM/);
assert.match(created.notice?.message ?? "", /Smile Orthodontics/);
assert.doesNotMatch(created.notice?.message ?? "", /email|sms|received/i);
assert.equal((created.notice?.message ?? "").includes(secret), false);
assert.equal(
  noticeLocation({
    visibility: "family",
    description: "Location: Smile Orthodontics\nBraces adjustment and private clinical note.",
  }),
  "Smile Orthodontics"
);
assert.equal(
  noticeLocation({
    visibility: "private",
    description: "Location: Smile Orthodontics\nBraces adjustment and private clinical note.",
  }),
  null
);
const linked = withCalendarEventRef(created.notice?.message ?? "", "event-1");
const shown = readCalendarEventRef(linked);
assert.equal(shown.eventId, "event-1");
assert.equal(shown.text.includes("[[calendar-event:"), false);
assert.equal(
  calendarNoticeHref({
    visibility: "family",
    eventId: "event-1",
    start: "2026-10-22T21:30:00.000Z",
    timezone: "America/Denver",
  }),
  "/calendar?event=event-1&year=2026&month=10"
);
assert.equal(
  calendarNoticeHref({
    visibility: "private",
    eventId: "event-1",
    start: "2026-10-22T21:30:00.000Z",
  }),
  null
);
assert.equal(
  calendarNoticeHref({
    visibility: "just_me_and_kids",
    eventId: "event-1",
    start: "2026-10-22T21:30:00.000Z",
  }),
  null
);
assert.equal(
  viewerCanOpenCalendarEvent({
    visibility: "private",
    createdBy: "parent-1",
    viewerId: "parent-2",
    description: secret,
  }),
  false
);
assert.equal(
  viewerCanOpenCalendarEvent({
    visibility: "family",
    createdBy: "parent-1",
    viewerId: "parent-2",
  }),
  true
);
const privateLink = calendarNoticeLink({
  message: linked,
  viewerId: "parent-2",
  memberCaseIds: ["case-1"],
  timezone: "America/Denver",
  event: {
    id: "event-1",
    caseId: "case-1",
    visibility: "private",
    createdBy: "parent-1",
    description: secret,
    start: "2026-10-22T21:30:00.000Z",
    deleted: false,
  },
});
assert.equal(privateLink.href, null);
assert.equal(privateLink.text.includes(secret), false);
const sharedLink = calendarNoticeLink({
  message: linked,
  viewerId: "parent-2",
  memberCaseIds: ["case-1"],
  timezone: "America/Denver",
  event: {
    id: "event-1",
    caseId: "case-1",
    visibility: "family",
    createdBy: "parent-1",
    description: "Location: Smile Orthodontics\nBraces adjustment and private clinical note.",
    start: "2026-10-22T21:30:00.000Z",
    deleted: false,
  },
});
assert.equal(sharedLink.href, "/calendar?event=event-1&year=2026&month=10");
assert.equal(sharedLink.text.includes("private clinical note"), false);

const pendingOnly = planCalendarNotice({
  eventId: "event-1",
  visibility: "family",
  choice: true,
  title: "Ashley — Orthodontist Appointment",
  kind: "created",
  start: "2026-10-22T21:30:00.000Z",
  end: null,
  actorId: "parent-1",
  members: [{ userId: "parent-1" }, { invited: true }],
  alreadySent: false,
});
assert.equal(pendingOnly.status, "not_registered");
assert.deepEqual(pendingOnly.recipientIds, []);
assert.equal(pendingOnly.pendingInvite, true);

const fingerprint = noticeFingerprint({
  eventId: "event-1",
  kind: "updated",
  title: "Ashley — Orthodontist Appointment",
  start: "2026-10-23T22:30:00.000Z",
  end: "2026-10-23T23:00:00.000Z",
  location: "Downtown Clinic",
});
assert.equal(
  fingerprint,
  noticeFingerprint({
    eventId: "event-1",
    kind: "updated",
    title: "Ashley — Orthodontist Appointment",
    start: "2026-10-23T22:30:00.000Z",
    end: "2026-10-23T23:00:00.000Z",
    location: "Downtown Clinic",
  })
);

const updated = planCalendarNotice({
  eventId: "event-1",
  visibility: "parents_only",
  choice: true,
  title: "Ashley — Orthodontist Appointment",
  kind: "updated",
  changes: calendarChangeLabels(
    {
      title: "Ashley — Orthodontist Appointment",
      start: "2026-10-22T21:30:00.000Z",
      end: "2026-10-22T22:00:00.000Z",
      location: "Smile Orthodontics",
    },
    {
      title: "Ashley — Orthodontist Appointment",
      start: "2026-10-23T22:30:00.000Z",
      end: "2026-10-23T23:00:00.000Z",
      location: "Downtown Clinic",
    }
  ),
  location: "Downtown Clinic",
  start: "2026-10-23T22:30:00.000Z",
  end: "2026-10-23T23:00:00.000Z",
  actorId: "parent-1",
  members: [{ userId: "parent-2", participating: true }],
  alreadySent: false,
});
assert.equal(updated.status, "sent");
assert.match(updated.notice?.message ?? "", /Changed: date, time, location/);
assert.equal(updated.notice?.fingerprint, fingerprint);

const retry = planCalendarNotice({
  eventId: "event-1",
  visibility: "parents_only",
  choice: true,
  title: "Ashley — Orthodontist Appointment",
  kind: "updated",
  location: "Downtown Clinic",
  start: "2026-10-23T22:30:00.000Z",
  end: "2026-10-23T23:00:00.000Z",
  actorId: "parent-1",
  members: [{ userId: "parent-2", participating: true }],
  alreadySent: true,
});
assert.equal(retry.status, "already_sent");
assert.equal(retry.notice?.fingerprint, fingerprint);

const declined = planCalendarNotice({
  eventId: "event-1",
  visibility: "family",
  choice: false,
  title: "Ashley — Orthodontist Appointment",
  kind: "created",
  start: "2026-10-22T21:30:00.000Z",
  end: null,
  actorId: "parent-1",
  members: [{ userId: "parent-2" }],
  alreadySent: false,
});
assert.equal(declined.status, "skipped");
assert.equal(declined.notice, null);

assert.equal(
  eventSubjectFromTexts(["Ashley has an orthodontist appointment"]),
  "Orthodontist Appointment"
);
assert.equal(
  resolveEventSubject("Orthodontist Appointment", [
    "What time is Ashley's orthodontist appointment?",
  ]),
  "Orthodontist Appointment"
);
assert.equal(resolveEventSubject("Orthodontist Appointment", ["3:30 PM"]), "Orthodontist Appointment");
