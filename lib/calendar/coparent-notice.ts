/**
 * In-app calendar notices for a co-parent who already belongs to the case.
 * A private event never produces a notice. An invited parent with no account
 * is not given a new delivery channel.
 */

export type CalendarAudience = "family" | "family_read_only" | "parents_only" | "just_me_and_kids" | "private" | string;

export type CaseMemberNotice = {
  userId?: string | null;
  participating?: boolean | null;
  invited?: boolean | null;
};

export type CalendarNoticeInput = {
  visibility: CalendarAudience | null | undefined;
  /** Null until the parent checks or unchecks the box. */
  choice?: boolean | null;
  title: string;
  kind: "created" | "updated";
  changes?: string[];
  location?: string | null;
  allDay?: boolean;
  timezone?: string | null;
};

export type CalendarNotice = {
  type: "calendar_event";
  title: string;
  message: string;
  priority: "normal";
  fingerprint: string;
};

export function sharedWithCoparent(visibility: CalendarAudience | null | undefined): boolean {
  return visibility === "family" || visibility === "family_read_only" || visibility === "parents_only";
}

/** Shared events start checked. Private events, and events the co-parent cannot see, start unchecked. */
export function defaultNotifyCoparent(visibility: CalendarAudience | null | undefined): boolean {
  return sharedWithCoparent(visibility);
}

/**
 * A private or kids-only event stays off. A deliberate choice is kept when the
 * co-parent is still allowed to see the event.
 */
export function effectiveNotifyCoparent(
  visibility: CalendarAudience | null | undefined,
  choice: boolean | null | undefined
): boolean {
  if (!sharedWithCoparent(visibility)) return false;
  if (typeof choice === "boolean") return choice;
  return true;
}

export function noticeFingerprint(input: {
  eventId: string;
  kind: "created" | "updated";
  title: string;
  start: string | null;
  end: string | null;
  location: string | null;
}): string {
  const parts = [
    input.kind,
    input.title.trim().slice(0, 120),
    input.start ?? "",
    input.end ?? "",
    (input.location ?? "").trim().slice(0, 120),
  ];
  return parts.join("|").slice(0, 400);
}

export function locationLine(description: string | null | undefined): string | null {
  if (!description) return null;
  const match = description.match(/^location:\s*(.+)$/im);
  const line = match?.[1]?.trim() ?? "";
  return line ? line.slice(0, 120) : null;
}

export function calendarChangeLabels(previous: {
  title?: string | null;
  start?: string | null;
  end?: string | null;
  location?: string | null;
} | null, next: {
  title?: string | null;
  start?: string | null;
  end?: string | null;
  location?: string | null;
}): string[] {
  if (!previous) return [];
  const labels: string[] = [];
  const previousDay = (previous.start ?? "").slice(0, 10);
  const nextDay = (next.start ?? "").slice(0, 10);
  if (previousDay !== nextDay) labels.push("date");
  const previousClock = `${(previous.start ?? "").slice(11, 16)}|${previous.end ?? ""}`;
  const nextClock = `${(next.start ?? "").slice(11, 16)}|${next.end ?? ""}`;
  if (previousClock !== nextClock) labels.push("time");
  if ((previous.location ?? "") !== (next.location ?? "")) labels.push("location");
  if ((previous.title ?? "").trim() !== (next.title ?? "").trim()) labels.push("title");
  return labels;
}

const EVENT_REF = /\n\[\[calendar-event:([A-Za-z0-9_-]{1,80})\]\]\s*$/;

export function safeEventId(eventId: string | null | undefined): string | null {
  const id = (eventId ?? "").trim();
  return /^[A-Za-z0-9_-]{1,80}$/.test(id) ? id : null;
}

/** A location line only. The rest of a description stays out of the notice. */
export function noticeLocation(input: {
  visibility: CalendarAudience | null | undefined;
  location?: string | null;
  description?: string | null;
}): string | null {
  if (!sharedWithCoparent(input.visibility)) return null;
  const explicit = (input.location ?? "").trim();
  const line = explicit || locationLine(input.description) || "";
  return line ? line.slice(0, 120) : null;
}

function noticeZone(timezone: string | null | undefined): string {
  const zone = (timezone ?? "").trim() || "America/Denver";
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: zone }).format(new Date());
    return zone;
  } catch {
    return "America/Denver";
  }
}

export function formatNoticeWhen(
  start: string | null,
  end: string | null,
  allDay: boolean,
  timezone: string | null | undefined
): string {
  if (!start) return "";
  const startDate = new Date(start);
  if (Number.isNaN(startDate.getTime())) return "";
  const zone = noticeZone(timezone);
  const day = new Intl.DateTimeFormat("en-US", {
    timeZone: zone,
    weekday: "short",
    month: "short",
    day: "numeric",
  }).format(startDate);
  if (allDay) return day;
  const clock = new Intl.DateTimeFormat("en-US", {
    timeZone: zone,
    hour: "numeric",
    minute: "2-digit",
  }).format(startDate);
  if (!end) return `${day}, ${clock}`;
  const endDate = new Date(end);
  if (Number.isNaN(endDate.getTime())) return `${day}, ${clock}`;
  const endClock = new Intl.DateTimeFormat("en-US", {
    timeZone: zone,
    hour: "numeric",
    minute: "2-digit",
  }).format(endDate);
  return `${day}, ${clock}–${endClock}`;
}

export function calendarNoticeHref(input: {
  visibility: CalendarAudience | null | undefined;
  eventId: string;
  start: string | null;
  timezone?: string | null;
}): string | null {
  if (!sharedWithCoparent(input.visibility)) return null;
  const id = safeEventId(input.eventId);
  if (!id) return null;
  const params = new URLSearchParams();
  params.set("event", id);
  if (input.start) {
    const when = new Date(input.start);
    if (!Number.isNaN(when.getTime())) {
      const parts = new Intl.DateTimeFormat("en-US", {
        timeZone: noticeZone(input.timezone),
        year: "numeric",
        month: "numeric",
      }).formatToParts(when);
      const year = parts.find((part) => part.type === "year")?.value;
      const month = parts.find((part) => part.type === "month")?.value;
      if (year && month) {
        params.set("year", year);
        params.set("month", month);
      }
    }
  }
  return `/calendar?${params.toString()}`;
}

export function withCalendarEventRef(message: string, eventId: string): string {
  const id = safeEventId(eventId);
  if (!id) return message;
  return `${message}\n[[calendar-event:${id}]]`;
}

export function readCalendarEventRef(message: string): { text: string; eventId: string | null } {
  const match = message.match(EVENT_REF);
  if (!match || match.index == null) return { text: message.trim(), eventId: null };
  return { text: message.slice(0, match.index).trim(), eventId: match[1] };
}

export function calendarNoticeLink(input: {
  message: string;
  event: {
    id: string;
    caseId: string;
    visibility: string | null;
    createdBy: string | null;
    description: string | null;
    start: string | null;
    deleted: boolean;
  } | null;
  viewerId: string;
  memberCaseIds: string[];
  timezone?: string | null;
}): { text: string; href: string | null } {
  const shown = readCalendarEventRef(input.message);
  const event = input.event;
  if (!shown.eventId || !event || event.id !== shown.eventId || !input.memberCaseIds.includes(event.caseId)) {
    return { text: shown.text, href: null };
  }
  if (!viewerCanOpenCalendarEvent({
    visibility: event.visibility,
    createdBy: event.createdBy,
    viewerId: input.viewerId,
    description: event.description,
    deleted: event.deleted,
  })) {
    return { text: shown.text, href: null };
  }
  return {
    text: shown.text,
    href: calendarNoticeHref({
      visibility: event.visibility,
      eventId: event.id,
      start: event.start,
      timezone: input.timezone,
    }),
  };
}

export function viewerCanOpenCalendarEvent(input: {
  visibility: string | null | undefined;
  createdBy: string | null | undefined;
  viewerId: string;
  description?: string | null;
  deleted?: boolean;
}): boolean {
  if (input.deleted) return false;
  const legacyPrivate = !input.visibility && (input.description ?? "").startsWith("[PRIVATE]");
  if (input.visibility === "private" || input.visibility === "just_me_and_kids" || legacyPrivate) {
    return input.createdBy === input.viewerId;
  }
  return sharedWithCoparent(input.visibility);
}

export function buildCalendarNotice(input: CalendarNoticeInput & {
  eventId: string;
  start: string | null;
  end: string | null;
}): CalendarNotice | null {
  if (!effectiveNotifyCoparent(input.visibility, input.choice)) return null;
  const title = input.title.trim().slice(0, 120) || "Calendar event";
  const location = noticeLocation({
    visibility: input.visibility,
    location: input.location,
  });
  const changes = (input.changes ?? []).filter((label) => label === "date" || label === "time" || label === "location" || label === "title");
  const headline = input.kind === "created" ? "Calendar event added" : "Calendar event updated";
  const action = input.kind === "created" ? "was added" : "was updated";
  const when = formatNoticeWhen(input.start, input.end, input.allDay === true, input.timezone);
  const lines = [`${title} ${action}.`];
  if (when) lines.push(when);
  if (location) lines.push(`Location: ${location}.`);
  if (input.kind === "updated" && changes.length > 0) lines.push(`Changed: ${changes.join(", ")}.`);
  return {
    type: "calendar_event",
    title: headline,
    message: lines.join("\n").slice(0, 420),
    priority: "normal",
    fingerprint: noticeFingerprint({
      eventId: input.eventId,
      kind: input.kind,
      title,
      start: input.start,
      end: input.end,
      location: location || null,
    }),
  };
}

export function registeredCoparentIds(members: CaseMemberNotice[], actorId: string): string[] {
  const ids: string[] = [];
  for (const member of members) {
    const id = member.userId?.trim() ?? "";
    if (!id || id === actorId) continue;
    if (member.participating === false) continue;
    ids.push(id);
  }
  return ids;
}

export function hasPendingCoparentInvite(members: CaseMemberNotice[], actorId: string): boolean {
  return members.some((member) => {
    const id = member.userId?.trim() ?? "";
    if (id && id !== actorId) return false;
    if (id === actorId) return false;
    return member.invited === true && member.participating !== false;
  });
}

export type NoticeDelivery = {
  notice: CalendarNotice | null;
  recipientIds: string[];
  /** Invited, with no account. Nothing is delivered to them. */
  pendingInvite: boolean;
  status: "sent" | "already_sent" | "not_registered" | "skipped";
};

export function planCalendarNotice(input: CalendarNoticeInput & {
  eventId: string;
  start: string | null;
  end: string | null;
  actorId: string;
  members: CaseMemberNotice[];
  alreadySent: boolean;
}): NoticeDelivery {
  const notice = buildCalendarNotice(input);
  if (!notice) return { notice: null, recipientIds: [], pendingInvite: false, status: "skipped" };
  const recipientIds = registeredCoparentIds(input.members, input.actorId);
  const pendingInvite = hasPendingCoparentInvite(input.members, input.actorId);
  if (recipientIds.length === 0) {
    return { notice, recipientIds, pendingInvite, status: pendingInvite ? "not_registered" : "skipped" };
  }
  if (input.alreadySent) {
    return { notice, recipientIds, pendingInvite, status: "already_sent" };
  }
  return { notice, recipientIds, pendingInvite, status: "sent" };
}
