import { documentAuthorizedForViewer } from "@/lib/documents-tab";

const MESSAGE_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export type OriginalAttachment = {
  id: string;
  fileName: string;
  mimeType: string | null;
  visibility: string | null;
  uploadedBy: string | null;
};

/** Opening the original does not mark the message read or send a receipt. Messages does not either. */
export function originalViewPolicy(): { markRead: false; sendReceipt: false; approve: false } {
  return { markRead: false, sendReceipt: false, approve: false };
}

export function isMessageId(value: string | null | undefined): boolean {
  return MESSAGE_ID.test((value ?? "").trim());
}

/**
 * Explicit links only: the journal source id, and a Sage item whose source is that message.
 * The same id is returned once. Nothing is chosen by time, subject, or text.
 */
export function linkedIncomingMessageIds(input: {
  sourceMessageId?: string | null;
  itemSourceType?: string | null;
  itemSourceId?: string | null;
}): string[] {
  const ids: string[] = [];
  const add = (value: string | null | undefined) => {
    const id = (value ?? "").trim();
    if (!isMessageId(id) || ids.includes(id)) return;
    ids.push(id);
  };
  add(input.sourceMessageId);
  if ((input.itemSourceType ?? "").trim() === "message") add(input.itemSourceId);
  return ids;
}

export function selectOriginalMessage<T extends { id: string }>(
  requestedId: string,
  rows: T[]
): T | null {
  const id = requestedId.trim();
  if (!isMessageId(id)) return null;
  return rows.find((row) => row.id === id) ?? null;
}

export function originalMessageAccess(input: {
  signedIn: boolean;
  role: string | null | undefined;
  memberCaseId: string | null | undefined;
  messageCaseId: string | null | undefined;
  direction: string | null | undefined;
  found: boolean;
}): "ok" | "unauthorized" | "forbidden" | "unavailable" {
  if (!input.signedIn) return "unauthorized";
  if (!input.found) return "unavailable";
  if ((input.direction ?? "").trim().toLowerCase() !== "incoming") return "unavailable";
  const role = (input.role ?? "").trim().toLowerCase();
  if (role === "child") return "forbidden";
  if (!input.memberCaseId || input.memberCaseId !== input.messageCaseId) return "forbidden";
  return "ok";
}

export function visibleOriginalAttachments(
  attachments: OriginalAttachment[],
  viewer: { userId: string; role: string | null | undefined }
): OriginalAttachment[] {
  return attachments.filter((attachment) =>
    documentAuthorizedForViewer(
      { visibility: attachment.visibility, uploadedBy: attachment.uploadedBy },
      viewer
    )
  );
}

/** Plain text for the saved body. HTML is stripped and remote images are not requested. */
export function safeOriginalBody(raw: string | null | undefined): string {
  const text = (raw ?? "").replace(/\r\n/g, "\n");
  if (!/<[a-z!/]/i.test(text)) return text;
  const stripped = text
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<img\b[^>]*>/gi, "[image]")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n")
    .replace(/<[^>]+>/g, "");
  return stripped
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&#10;/g, "\n")
    .replace(/&#13;/g, "");
}
