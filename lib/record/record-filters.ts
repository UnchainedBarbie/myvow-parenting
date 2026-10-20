import { isRecordCategoryId, recordCategoryLabel } from "@/lib/record/record-categories";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export type DatePreset = "all" | "30" | "90" | "180" | "custom";
export type DirectionFilter = "all" | "sent" | "received";

export type RecordFilterInput = {
  datePreset: DatePreset;
  from: string | null;
  to: string | null;
  category: string | null;
  conversationId: string | null;
  direction: DirectionFilter;
  search: string;
  attachmentsOnly: boolean;
};

export type ParentIdentity = {
  userId: string;
  emails: string[];
};

export type FilterableMessage = {
  createdAtMs: number;
  conversationId: string | null;
  originalContent: string;
  senderId: string | null;
  senderExternalEmail: string | null;
  hasAttachments: boolean;
  messageId: string;
};

export type ConversationMeta = {
  id: string;
  subject: string;
  categories: ReadonlySet<string>;
};

type SearchParams = Record<string, string | string[] | undefined>;

function firstParam(value: string | string[] | undefined): string {
  if (Array.isArray(value)) return value[0] ?? "";
  return value ?? "";
}

function cleanDate(value: string): string | null {
  const trimmed = value.trim();
  if (!DATE_RE.test(trimmed)) return null;
  const [year, month, day] = trimmed.split("-").map(Number);
  const probe = new Date(Date.UTC(year, month - 1, day));
  if (
    probe.getUTCFullYear() !== year ||
    probe.getUTCMonth() !== month - 1 ||
    probe.getUTCDate() !== day
  ) {
    return null;
  }
  return trimmed;
}

export function parseRecordFilters(searchParams: SearchParams): RecordFilterInput {
  const range = firstParam(searchParams.range).trim();
  const datePreset: DatePreset =
    range === "30" || range === "90" || range === "180" || range === "custom" ? range : "all";
  const directionRaw = firstParam(searchParams.direction).trim();
  const direction: DirectionFilter =
    directionRaw === "sent" || directionRaw === "received" ? directionRaw : "all";
  const categoryRaw = firstParam(searchParams.category).trim();
  const conversationRaw = firstParam(searchParams.conversation).trim();
  const search = firstParam(searchParams.q).trim().slice(0, 200);
  const attachments = firstParam(searchParams.attachments).trim().toLowerCase();

  return {
    datePreset,
    from: cleanDate(firstParam(searchParams.from)),
    to: cleanDate(firstParam(searchParams.to)),
    category: isRecordCategoryId(categoryRaw) ? categoryRaw : null,
    conversationId: UUID_RE.test(conversationRaw) ? conversationRaw : null,
    direction,
    search,
    attachmentsOnly: attachments === "1" || attachments === "true",
  };
}

export function calendarDateInZone(date: Date, timeZone: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

export function shiftCalendarDate(isoDate: string, days: number): string {
  const [year, month, day] = isoDate.split("-").map(Number);
  const shifted = new Date(Date.UTC(year, month - 1, day));
  shifted.setUTCDate(shifted.getUTCDate() + days);
  return shifted.toISOString().slice(0, 10);
}

function zonedTimeToUtc(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  second: number,
  millisecond: number,
  timeZone: string
): Date {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  });
  const wallClockAsUtc = (instant: Date) => {
    const parts = Object.fromEntries(
      formatter.formatToParts(instant).map((part) => [part.type, part.value])
    );
    let wallHour = Number(parts.hour);
    let wallDay = Number(parts.day);
    let wallMonth = Number(parts.month);
    let wallYear = Number(parts.year);
    if (wallHour === 24) wallHour = 0;
    return Date.UTC(wallYear, wallMonth - 1, wallDay, wallHour, Number(parts.minute), Number(parts.second), millisecond);
  };
  const desired = Date.UTC(year, month - 1, day, hour, minute, second, millisecond);
  let utc = desired;
  for (let pass = 0; pass < 3; pass += 1) {
    const shown = wallClockAsUtc(new Date(utc));
    const next = utc + (desired - shown);
    if (next === utc) break;
    utc = next;
  }
  return new Date(utc);
}

export function zonedDayStartMs(isoDate: string, timeZone: string): number {
  const [year, month, day] = isoDate.split("-").map(Number);
  return zonedTimeToUtc(year, month, day, 0, 0, 0, 0, timeZone).getTime();
}

export function zonedDayEndMs(isoDate: string, timeZone: string): number {
  const [year, month, day] = isoDate.split("-").map(Number);
  return zonedTimeToUtc(year, month, day, 23, 59, 59, 999, timeZone).getTime();
}

export function resolveDateRange(
  filters: RecordFilterInput,
  timeZone: string,
  now: Date
): { from: string; to: string } | null {
  if (filters.datePreset === "all") return null;
  if (filters.datePreset === "custom") {
    if (!filters.from || !filters.to) return null;
    return filters.from <= filters.to
      ? { from: filters.from, to: filters.to }
      : { from: filters.to, to: filters.from };
  }
  const days = filters.datePreset === "30" ? 30 : filters.datePreset === "90" ? 90 : 180;
  const to = calendarDateInZone(now, timeZone);
  return { from: shiftCalendarDate(to, -days), to };
}

export function resolveParentSender(
  message: { senderId: string | null; senderExternalEmail: string | null },
  parents: ParentIdentity[]
): string | null {
  if (message.senderId) {
    return parents.some((parent) => parent.userId === message.senderId) ? message.senderId : null;
  }
  const email = message.senderExternalEmail?.trim().toLowerCase() ?? "";
  if (!email) return null;
  const matches = parents.filter((parent) => parent.emails.includes(email));
  return matches.length === 1 ? matches[0].userId : null;
}

export function messageMatchesFilters(
  message: FilterableMessage,
  filters: RecordFilterInput,
  options: {
    timeZone: string;
    now: Date;
    conversations: Map<string, ConversationMeta>;
    attachmentMessageIds: ReadonlySet<string>;
    viewerId: string;
    parents: ParentIdentity[];
    categoryAvailable: boolean;
  }
): boolean {
  const conversation = message.conversationId
    ? options.conversations.get(message.conversationId)
    : undefined;

  if (filters.category && options.categoryAvailable) {
    if (!conversation?.categories.has(filters.category)) return false;
  }

  if (filters.conversationId) {
    if (message.conversationId !== filters.conversationId) return false;
  }

  const range = resolveDateRange(filters, options.timeZone, options.now);
  if (range) {
    const start = zonedDayStartMs(range.from, options.timeZone);
    const end = zonedDayEndMs(range.to, options.timeZone);
    if (message.createdAtMs < start || message.createdAtMs > end) return false;
  }

  if (filters.direction !== "all") {
    const sender = resolveParentSender(
      { senderId: message.senderId, senderExternalEmail: message.senderExternalEmail },
      options.parents
    );
    if (filters.direction === "sent") {
      if (sender !== options.viewerId) return false;
    } else {
      const coParent = options.parents.some(
        (parent) => parent.userId === sender && parent.userId !== options.viewerId
      );
      if (!coParent) return false;
    }
  }

  const query = filters.search.trim().toLowerCase();
  if (query) {
    const body = message.originalContent.toLowerCase();
    const subject = conversation?.subject.toLowerCase() ?? "";
    if (!body.includes(query) && !subject.includes(query)) return false;
  }

  if (filters.attachmentsOnly) {
    const linked = options.attachmentMessageIds.has(message.messageId);
    if (!linked && !message.hasAttachments) return false;
  }

  return true;
}

export type AppliedFilterLine = { label: string; value: string };

function formatDayLabel(isoDate: string): { month: string; day: number; year: number } {
  const [year, month, day] = isoDate.split("-").map(Number);
  const monthName = new Intl.DateTimeFormat("en-US", {
    month: "long",
    timeZone: "UTC",
  }).format(new Date(Date.UTC(year, month - 1, day)));
  return { month: monthName, day, year };
}

export function formatDateSpan(from: string, to: string): string {
  const start = formatDayLabel(from);
  const end = formatDayLabel(to);
  if (from === to) return `${start.month} ${start.day}, ${start.year}`;
  if (start.year === end.year && start.month === end.month) {
    return `${start.month} ${start.day}-${end.day}, ${start.year}`;
  }
  if (start.year === end.year) {
    return `${start.month} ${start.day}-${end.month} ${end.day}, ${start.year}`;
  }
  return `${start.month} ${start.day}, ${start.year}-${end.month} ${end.day}, ${end.year}`;
}

export function appliedFilterLines(
  filters: RecordFilterInput,
  options: {
    timeZone: string;
    now: Date;
    conversationSubject: string | null;
    categoryAvailable: boolean;
  }
): AppliedFilterLine[] {
  const lines: AppliedFilterLine[] = [];
  const range = resolveDateRange(filters, options.timeZone, options.now);
  if (range) lines.push({ label: "Date", value: formatDateSpan(range.from, range.to) });
  if (filters.category && options.categoryAvailable) {
    const label = recordCategoryLabel(filters.category);
    if (label) lines.push({ label: "Category", value: label });
  }
  if (filters.conversationId) {
    lines.push({
      label: "Conversation",
      value: options.conversationSubject ?? "Not in this case",
    });
  }
  if (filters.direction === "sent") lines.push({ label: "Direction", value: "Sent by Me" });
  if (filters.direction === "received") {
    lines.push({ label: "Direction", value: "Received from Co-Parent" });
  }
  if (filters.search.trim()) lines.push({ label: "Search", value: filters.search.trim() });
  if (filters.attachmentsOnly) {
    lines.push({ label: "Attachments", value: "Only messages with attachments" });
  }
  return lines;
}

export function filtersRestrict(lines: AppliedFilterLine[]): boolean {
  return lines.length > 0;
}

export function completenessStatement(options: {
  included: number;
  eligible: number;
  notPassed: number;
  filtered: boolean;
}): string {
  if (!options.filtered) {
    const includedText = `${options.included} message${options.included === 1 ? " is" : "s are"} included.`;
    const excludedText = `${options.notPassed} message${options.notPassed === 1 ? " is" : "s are"} excluded`;
    if (options.notPassed === 0) {
      return `This is the complete record of messages in this case. ${includedText} ${excludedText}.`;
    }
    return `This is a filtered view, not the complete record of the case. ${includedText} ${excludedText} because ${options.notPassed === 1 ? "it" : "they"} did not pass between the parents. Excluded messages retain their numbers.`;
  }

  const includedWord = options.included === 1 ? "message is" : "messages are";
  const eligibleWord = options.eligible === 1 ? "message" : "messages";
  let text = `This is a filtered communication record. ${options.included} ${includedWord} included from ${options.eligible} eligible parent-to-parent ${eligibleWord} in this case.`;
  if (options.notPassed > 0) {
    const extra =
      options.notPassed === 1
        ? "1 additional message is omitted because it is not a communication that passed between the parents."
        : `${options.notPassed} additional messages are omitted because they are not communications that passed between the parents.`;
    text += ` ${extra} That exclusion is separate from the filters above.`;
  }
  text += " Messages left out by these filters remain in the case record.";
  return text;
}
