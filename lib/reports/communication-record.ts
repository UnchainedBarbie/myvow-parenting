import { recordCategoryLabel } from "@/lib/record/record-categories";
import { formatWhen, safeZone } from "@/lib/record/record-present";

export type CommunicationAttachment = {
  documentId: string;
  label: string;
  fileName: string;
  documentNumber: number | null;
  storagePath: string | null;
  mimeType: string | null;
  visibility: string | null;
  uploadedBy: string | null;
  authorized: boolean;
};

export type CommunicationDirection = "incoming" | "outgoing" | "unknown";

export type CommunicationRow = {
  id: string;
  number: string;
  conversationId: string;
  subject: string;
  threadKey: string;
  threadHeading: string;
  createdAt: string;
  deliveredAt: string | null;
  direction: CommunicationDirection;
  sender: string;
  transcriptWho: string;
  recipient: string;
  body: string;
  transcriptText: string;
  transcriptOmitted: boolean;
  categories: string[];
  attachments: CommunicationAttachment[];
  deliveryLines: string[];
  recordedLabel: string;
};

export type CommunicationThread = {
  heading: string;
  rows: CommunicationRow[];
};

export type CommunicationRecordModel = {
  caseLabel: string;
  parties: string[];
  timezone: string;
  generatedAtIso: string;
  generatedLabel: string;
  reportingPeriod: string;
  messageSpan: string;
  filterLines: { label: string; value: string }[];
  completeness: string;
  categoryNotice: string | null;
  rows: CommunicationRow[];
  threads: CommunicationThread[];
};

export type EvidenceRef = { label: string; page: number };

export function compareCommunicationRows(
  a: { createdAt: string; id: string },
  b: { createdAt: string; id: string }
): number {
  const left = new Date(a.createdAt).getTime();
  const right = new Date(b.createdAt).getTime();
  const aMs = Number.isNaN(left) ? 0 : left;
  const bMs = Number.isNaN(right) ? 0 : right;
  return aMs - bMs || a.id.localeCompare(b.id);
}

/** The other parent, only when the sender is one of exactly two parents on the case. */
export function recipientLabel(
  senderUserId: string | null,
  parents: { userId: string; label: string }[]
): string {
  if (!senderUserId) return "Not recorded";
  if (!parents.some((parent) => parent.userId === senderUserId)) return "Not recorded";
  const others = parents.filter((parent) => parent.userId !== senderUserId);
  if (others.length !== 1) return "Not recorded";
  return others[0].label.trim() || "Not recorded";
}

export function storedDirection(value: string | null | undefined): CommunicationDirection {
  const direction = (value ?? "").trim().toLowerCase();
  if (direction === "incoming" || direction === "outgoing") return direction;
  return "unknown";
}

export function directionLabel(direction: CommunicationDirection): string {
  if (direction === "incoming") return "Incoming";
  if (direction === "outgoing") return "Outgoing";
  return "Not recorded";
}

export function subjectText(subject: string | null | undefined): string {
  const stored = subject?.trim() ?? "";
  return stored || "No subject recorded";
}

export function approvedCategoryText(categoryIds: Iterable<string>): string {
  const labels = [...categoryIds]
    .map((id) => recordCategoryLabel(id))
    .filter((label): label is string => Boolean(label))
    .sort((a, b) => a.localeCompare(b));
  return labels.join("; ");
}

/** Timestamp with a numeric offset so spreadsheet apps keep the zone. */
export function formatStamp(iso: string, timeZone: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  const zone = safeZone(timeZone);
  const options: Intl.DateTimeFormatOptions = {
    timeZone: zone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
    timeZoneName: "shortOffset",
  };
  let parts: Intl.DateTimeFormatPart[];
  try {
    parts = new Intl.DateTimeFormat("en-US", options).formatToParts(date);
  } catch {
    parts = new Intl.DateTimeFormat("en-US", { ...options, timeZoneName: "short" }).formatToParts(date);
  }
  const get = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value ?? "";
  const offset = (get("timeZoneName") || zone).replace("GMT", "UTC");
  return `${get("year")}-${get("month")}-${get("day")} ${get("hour")}:${get("minute")}:${get("second")} ${offset}`;
}

export function sentStamp(row: CommunicationRow, timeZone: string): string {
  if (row.direction !== "outgoing") return "";
  return formatStamp(row.createdAt, timeZone);
}

export function receivedStamp(row: CommunicationRow, timeZone: string): string {
  if (row.direction !== "incoming" || !row.deliveredAt) return "";
  return formatStamp(row.deliveredAt, timeZone);
}

export function deliveredStamp(row: CommunicationRow, timeZone: string): string {
  if (!row.deliveredAt) return "";
  return formatStamp(row.deliveredAt, timeZone);
}

export function dateCell(row: CommunicationRow, timeZone: string): string {
  const lines = [`Recorded ${row.recordedLabel || formatWhen(row.createdAt, timeZone)}`];
  if (row.deliveredAt) lines.push(`Delivered ${formatWhen(row.deliveredAt, timeZone)}`);
  return lines.join("\n");
}

export function csvField(value: string): string {
  if (/[",\r\n]/.test(value)) return `"${value.replace(/"/g, '""')}"`;
  return value;
}

export const CSV_HEADERS = [
  "Message ID",
  "Conversation ID",
  "Subject",
  "Recorded timestamp",
  "Sent timestamp",
  "Received timestamp",
  "Delivered timestamp",
  "Sender",
  "Recipient",
  "Direction",
  "Original message body",
  "Attachments",
  "Category",
] as const;

export function communicationCsv(model: CommunicationRecordModel): string {
  const lines = [CSV_HEADERS.map((header) => csvField(header)).join(",")];
  for (const row of model.rows) {
    const values = [
      row.number,
      row.conversationId,
      row.subject,
      formatStamp(row.createdAt, model.timezone),
      sentStamp(row, model.timezone),
      receivedStamp(row, model.timezone),
      deliveredStamp(row, model.timezone),
      row.sender,
      row.recipient,
      directionLabel(row.direction),
      row.body,
      row.attachments.map((attachment) => attachment.label).join("; "),
      approvedCategoryText(row.categories),
    ];
    lines.push(values.map((value) => csvField(value)).join(","));
  }
  return `\uFEFF${lines.join("\r\n")}\r\n`;
}

export function evidenceLabel(start: number, end: number): string {
  return start === end ? `p. ${start}` : `pp. ${start}–${end}`;
}

function attachmentDocumentLabel(number: number | null): string {
  if (number == null || !Number.isFinite(number)) return "Document number not assigned";
  return `DOC-${String(Math.trunc(number)).padStart(3, "0")}`;
}

export function planEvidence(
  ledgerPages: number,
  files: { records: string[]; pages: number; documentLabel?: string | null; unavailable?: boolean }[]
): Map<string, EvidenceRef[]> {
  const map = new Map<string, EvidenceRef[]>();
  let page = Math.max(ledgerPages, 0) + 1;
  for (const file of files) {
    const count = Math.max(file.pages, 1);
    const start = page;
    const end = page + count - 1;
    page = end + 1;
    const id = file.documentLabel?.trim() || "Document number not assigned";
    const label = file.unavailable
      ? `${id}\nAttachment unavailable`
      : `${id}, ${evidenceLabel(start, end)}`;
    const ref = { label, page: file.unavailable ? 0 : start };
    for (const record of file.records) {
      const list = map.get(record) ?? [];
      list.push(ref);
      map.set(record, list);
    }
  }
  return map;
}

export function evidenceLines(
  row: CommunicationRow,
  planned: Map<string, EvidenceRef[]> | null
): { text: string; targetPage: number | null }[] {
  if (row.attachments.length === 0) return [{ text: "No attachment", targetPage: null }];
  if (!planned) {
    return row.attachments.map((attachment) => ({
      text: `${attachmentDocumentLabel(attachment.documentNumber)}\nAttachments excluded from this export`,
      targetPage: null,
    }));
  }
  const lines: { text: string; targetPage: number | null }[] = (planned.get(row.number) ?? []).map((ref) => ({
    text: ref.label,
    targetPage: ref.page > 0 ? ref.page : null,
  }));
  for (const attachment of row.attachments) {
    if (attachment.authorized) continue;
    lines.push({
      text: `${attachmentDocumentLabel(attachment.documentNumber)}\nAttachment unavailable`,
      targetPage: null,
    });
  }
  if (lines.length === 0) {
    return row.attachments.map((attachment) => ({
      text: `${attachmentDocumentLabel(attachment.documentNumber)}\nAttachment unavailable`,
      targetPage: null,
    }));
  }
  return lines;
}

export function verificationPayload(
  model: CommunicationRecordModel,
  layout: "table" | "transcript",
  includeAttachments: boolean
): string {
  return JSON.stringify({
    case: model.caseLabel,
    layout,
    timezone: model.timezone,
    generatedAt: model.generatedAtIso,
    reportingPeriod: model.reportingPeriod,
    includeAttachments,
    filters: model.filterLines,
    messages: model.rows.map((row) => ({
      number: row.number,
      id: row.id,
      conversationId: row.conversationId,
      subject: row.subject,
      createdAt: row.createdAt,
      deliveredAt: row.deliveredAt,
      direction: row.direction,
      sender: row.sender,
      recipient: row.recipient,
      body: row.body,
      categories: row.categories,
      attachments: row.attachments.map((attachment) => attachment.documentId),
    })),
  });
}
