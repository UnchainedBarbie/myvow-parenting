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

export function buildCalendarNotice(input: CalendarNoticeInput & {
  eventId: string;
  start: string | null;
  end: string | null;
}): CalendarNotice | null {
  if (!effectiveNotifyCoparent(input.visibility, input.choice)) return null;
  const title = input.title.trim().slice(0, 120) || "Calendar event";
  const location = sharedWithCoparent(input.visibility) ? (input.location ?? "").trim() : "";
  const changes = (input.changes ?? []).filter((label) => label === "date" || label === "time" || label === "location" || label === "title");
  const headline = input.kind === "created" ? "Calendar event added" : "Calendar event updated";
  const detail = input.kind === "created"
    ? `${title} was added to the calendar.`
    : changes.length > 0
      ? `${title} was updated. Changed: ${changes.join(", ")}.`
      : `${title} was updated.`;
  const place = location ? ` Location: ${location}.` : "";
  return {
    type: "calendar_event",
    title: headline,
    message: `${detail}${place} This is an in-app notice. No email was sent.`.slice(0, 500),
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
