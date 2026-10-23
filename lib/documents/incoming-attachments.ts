import { documentAuthorizedForViewer } from "@/lib/documents-tab";

export const INCOMING_ATTACHMENT_LABEL = "Incoming attachment";
export const NOT_FILED_LABEL = "Not filed";

export type IncomingDocument = {
  id: string;
  fileName: string;
  status: string | null;
  visibility: string | null;
  uploadedBy: string | null;
};

export type IncomingMessageLink = {
  documentId: string;
  messageId: string;
  conversationId: string | null;
  sender: string | null;
  receivedAt: string | null;
  direction: string | null;
  caseId: string | null;
};

export type IncomingLibraryEntry = {
  id: string;
  fileName: string;
  status: "pending";
  filing: "incoming";
  label: typeof INCOMING_ATTACHMENT_LABEL;
  unfiledLabel: typeof NOT_FILED_LABEL;
  messageId: string;
  conversationId: string | null;
  sender: string | null;
  receivedAt: string | null;
  messageHref: string | null;
};

export function originalMessageHref(conversationId: string): string {
  return `/messages?conversation_id=${encodeURIComponent(conversationId)}`;
}

/**
 * Pending documents already linked to an incoming message on this case.
 * The same stored row is listed once. Nothing is copied or marked filed.
 */
export function incomingLibraryEntries(input: {
  documents: IncomingDocument[];
  links: IncomingMessageLink[];
  caseId: string;
  viewer: { userId: string; role: string | null };
}): IncomingLibraryEntry[] {
  const byDocument = new Map<string, IncomingMessageLink>();
  for (const link of input.links) {
    if (byDocument.has(link.documentId)) continue;
    if ((link.direction ?? "").trim().toLowerCase() !== "incoming") continue;
    if (link.caseId !== input.caseId) continue;
    if (!link.messageId) continue;
    byDocument.set(link.documentId, link);
  }

  const entries: IncomingLibraryEntry[] = [];
  for (const doc of input.documents) {
    if ((doc.status ?? "").trim().toLowerCase() !== "pending") continue;
    const link = byDocument.get(doc.id);
    if (!link) continue;
    const allowed = documentAuthorizedForViewer(
      { visibility: doc.visibility, uploadedBy: doc.uploadedBy },
      input.viewer
    );
    if (!allowed) continue;
    const conversationId = (link.conversationId ?? "").trim() || null;
    entries.push({
      id: doc.id,
      fileName: doc.fileName,
      status: "pending",
      filing: "incoming",
      label: INCOMING_ATTACHMENT_LABEL,
      unfiledLabel: NOT_FILED_LABEL,
      messageId: link.messageId,
      conversationId,
      sender: (link.sender ?? "").trim() || null,
      receivedAt: (link.receivedAt ?? "").trim() || null,
      messageHref: conversationId ? originalMessageHref(conversationId) : null,
    });
  }
  return entries;
}

export function librarySearchText(input: {
  title?: string | null;
  fileName?: string | null;
  category?: string | null;
  description?: string | null;
  sender?: string | null;
  filing?: "incoming" | "filed" | null;
}): string {
  const parts = [
    input.title,
    input.fileName,
    input.category,
    input.description,
    input.sender,
  ];
  if (input.filing === "incoming") {
    parts.push(INCOMING_ATTACHMENT_LABEL, NOT_FILED_LABEL, "unfiled");
  }
  return parts
    .filter((part): part is string => typeof part === "string" && part.trim().length > 0)
    .join(" ")
    .toLowerCase();
}
