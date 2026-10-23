import { documentExtension } from "@/lib/documents-files";
import { documentAuthorizedForViewer } from "@/lib/documents-tab";
import { isDocumentFilingRequest } from "@/lib/sage/document-intent";
import type { KnownCoparent } from "@/lib/sage/chat-intent";
import type { KnownDocumentChild } from "@/lib/sage/document-intent";

export type AttachmentInstruction = "message" | "save" | "summarize" | "save_and_message" | "other";

const SENDABLE = new Set([
  "pdf", "png", "jpg", "jpeg", "gif", "webp", "doc", "docx", "xls", "xlsx", "csv", "txt",
]);

/** The parent's words decide what the file is for. The file does not decide. */
export function attachmentInstruction(text: string): AttachmentInstruction {
  const save = asksToSave(text);
  const message = asksToMessage(text);
  if (save && message) return "save_and_message";
  if (message) return "message";
  if (asksToSummarize(text)) return "summarize";
  if (save) return "save";
  return "other";
}

export function attachmentCanBeSent(fileName: string): boolean {
  return SENDABLE.has(documentExtension(fileName));
}

export function mentionsSeveralChildren(text: string): boolean {
  return /\b(children|kids|both (?:of )?(?:the )?(?:kids|children)|our kids)\b/i.test(text);
}

/** A child named in the instruction. A name that appears only in the filename does not count. */
export function childNamedInInstruction(
  text: string,
  children: KnownDocumentChild[]
): KnownDocumentChild | null {
  if (mentionsSeveralChildren(text)) {
    const named = children.filter((child) => new RegExp(`\\b${escapeRegExp(child.name)}\\b`, "i").test(text));
    return named.length === 1 ? named[0] : null;
  }
  const named = children.filter((child) => new RegExp(`\\b${escapeRegExp(child.name)}\\b`, "i").test(text));
  return named.length === 1 ? named[0] : null;
}

export function attachedMessageDraft(text: string, fileName: string): string {
  const file = fileName.trim() || "the attached file";
  const review = /\b(review|feedback|thoughts|look at|weigh in|opinion)\b/i.test(text);
  const pediatrician = /\bpediatricians?\b/i.test(text);
  const children = mentionsSeveralChildren(text);
  if (pediatrician && children && review) {
    return `I attached ${file} so we can choose a pediatrician for the children. Please review the list and share your thoughts.`;
  }
  if (review) return `I attached ${file}. Please review it and share your thoughts.`;
  return `I attached ${file}.`;
}

export function attachedMessageRecipient(
  text: string,
  coparents: KnownCoparent[]
): { kind: "one"; coparent: KnownCoparent } | { kind: "clarify"; reply: string } {
  const named = coparents.filter((coparent) => {
    const token = coparent.name.trim().split(/\s+/)[0] ?? "";
    return token.length > 1 && new RegExp(`\\b${escapeRegExp(token)}\\b`, "i").test(text);
  });
  const unique = [...new Map(named.map((coparent) => [coparent.name.toLowerCase(), coparent])).values()];
  if (unique.length > 1) {
    return { kind: "clarify", reply: "More than one person matches that name. Who should I address?" };
  }
  if (unique.length === 1) return { kind: "one", coparent: unique[0] };
  if (coparents.length === 1) return { kind: "one", coparent: coparents[0] };
  if (coparents.length === 0) {
    return { kind: "clarify", reply: "I don't have a co-parent on this case to send that to." };
  }
  return { kind: "clarify", reply: "Who should I send that to? I won't guess between co-parents." };
}

export function messageAttachmentDecision(input: {
  documentCaseId: string;
  messageCaseId: string;
  uploadedBy: string;
  senderId: string;
  visibility: string | null;
  status: string | null;
  fileName: string;
  recipientUserId: string | null;
  recipientRole: string | null;
  recipientOnCase: boolean;
}): { link: boolean; fileName: string; reason: string | null } {
  const fileName = input.fileName.trim();
  if (input.documentCaseId !== input.messageCaseId) {
    return { link: false, fileName, reason: "The file is not on this case." };
  }
  if (input.uploadedBy !== input.senderId) {
    return { link: false, fileName, reason: "The file was uploaded by someone else." };
  }
  const status = (input.status ?? "").trim().toLowerCase();
  if (status === "dismissed" || status === "deleted") {
    return { link: false, fileName, reason: "That file is no longer available." };
  }
  if (!input.recipientOnCase || !input.recipientUserId) {
    return { link: false, fileName, reason: "The recipient is not a member of this case." };
  }
  if (input.recipientUserId === input.senderId) {
    return { link: false, fileName, reason: "The recipient is the sender." };
  }
  const allowed = documentAuthorizedForViewer(
    { visibility: input.visibility, uploadedBy: input.uploadedBy },
    { userId: input.recipientUserId, role: input.recipientRole }
  );
  if (!allowed) {
    return { link: false, fileName, reason: "The recipient is not allowed to open this file." };
  }
  return { link: true, fileName, reason: null };
}

function asksToMessage(text: string): boolean {
  if (/\battach(?:ed|ing)?\b/i.test(text) && /\bmessage\b/i.test(text)) return true;
  if (/\b(send|share|forward)\b/i.test(text) && /\b(co-?parents?|him|her|them)\b/i.test(text)) return true;
  if (/\bhave\b/i.test(text) && /\bco-?parents?\b/i.test(text) && /\b(review|see|look|read|thoughts|feedback)\b/i.test(text)) {
    return true;
  }
  if (/\b(ask|get)\b/i.test(text) && /\b(feedback|thoughts|review)\b/i.test(text) && /\b(co-?parents?|him|her)\b/i.test(text)) {
    return true;
  }
  if (/\bsend this\b/i.test(text) && /\b(spreadsheet|pdf|file|list|document|attachment)\b/i.test(text)) return true;
  return false;
}

function asksToSave(text: string): boolean {
  if (isDocumentFilingRequest(text)) return true;
  return /\b(save|file|store|keep)\b/i.test(text) && /\b(documents?|spreadsheet)\b/i.test(text);
}

function asksToSummarize(text: string): boolean {
  return /\b(summarize|summarise|summary|sum up|what does (?:this|it) say|analyze|analyse)\b/i.test(text);
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
