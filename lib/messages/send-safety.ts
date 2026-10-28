/**
 * Attachment handling for a parent-to-parent send.
 * A file shared with a message is shared inside MyVow. The email carries the message text only.
 * A parent who expected to share a file is told when the file cannot be shared.
 */

export type AttachmentIntent = {
  /** The parent expects a file to travel with this message. */
  expected: boolean;
  documentId: string | null;
  fileName: string | null;
};

export function attachmentIntent(proposal: {
  attached_document_id?: string | null;
  attached_file_name?: string | null;
  attached_file_url?: string | null;
}): AttachmentIntent {
  const documentId = (proposal.attached_document_id ?? "").trim() || null;
  const fileName = (proposal.attached_file_name ?? "").trim() || null;
  const url = (proposal.attached_file_url ?? "").trim();
  return { expected: Boolean(documentId || fileName || url), documentId, fileName };
}

export type AttachmentOutcome =
  | { status: "none" }
  | { status: "shared_in_myvow"; documentId: string; fileName: string }
  | { status: "omitted_acknowledged"; fileName: string | null; reason: string }
  /** The message is saved and the file link failed. The parent is told, and can share the file again. */
  | { status: "share_failed"; fileName: string | null; reason: string };

export type AttachmentPreflight =
  | { action: "send_without_file" }
  | { action: "send_with_file"; documentId: string; fileName: string }
  | { action: "send_without_file_acknowledged"; fileName: string | null; reason: string }
  | { action: "block"; fileName: string | null; reason: string };

export const ATTACHMENT_NOT_SHAREABLE_CODE = "attachment_not_shareable";

/**
 * Decide what to do with the file before the message is saved.
 * `eligibility` is the result of the document and recipient checks for the intended file.
 */
export function attachmentPreflight(input: {
  intent: AttachmentIntent;
  eligibility: { link: boolean; fileName: string; reason: string | null } | null;
  acknowledgedOmission: boolean;
}): AttachmentPreflight {
  const { intent } = input;
  if (!intent.expected) return { action: "send_without_file" };

  const eligibility = input.eligibility;
  if (intent.documentId && eligibility?.link) {
    return {
      action: "send_with_file",
      documentId: intent.documentId,
      fileName: eligibility.fileName || intent.fileName || "attachment",
    };
  }

  const reason = !intent.documentId
    ? "The file is not saved in MyVow, so it cannot be shared."
    : eligibility?.reason || "The file cannot be shared with your co-parent.";
  const fileName = eligibility?.fileName?.trim() || intent.fileName;
  if (input.acknowledgedOmission) {
    return { action: "send_without_file_acknowledged", fileName, reason };
  }
  return { action: "block", fileName, reason };
}

export function attachmentBlockedMessage(input: { fileName: string | null; reason: string }): string {
  const name = input.fileName ? `"${input.fileName}"` : "The attached file";
  return `${name} cannot be shared with this message. ${input.reason} Nothing was sent. You can send the message without the file.`;
}

/** Wording used wherever a shared file is described next to a sent message. */
export const ATTACHMENT_SCOPE_NOTE = "Shared in MyVow. The email carries the message text only.";

export function attachmentOutcomeLabel(outcome: AttachmentOutcome | null | undefined): string | null {
  if (!outcome || outcome.status === "none") return null;
  if (outcome.status === "shared_in_myvow") {
    return `${outcome.fileName}: ${ATTACHMENT_SCOPE_NOTE}`;
  }
  const prefix = outcome.fileName ? `${outcome.fileName}: ` : "";
  if (outcome.status === "share_failed") {
    return `${prefix}The message was saved. The file was not shared. ${outcome.reason}`;
  }
  return `${prefix}Sent without the file. ${outcome.reason}`;
}

/** Shown on a draft that carries a file, before the parent sends it. */
export function pendingAttachmentNote(fileName: string): string {
  return `${fileName}: will be shared inside MyVow. It is not attached to the email.`;
}
