import { sageAttachmentSentences, type AttachmentNotice } from "@/lib/messages/inbound-attachment";

export type StoredIntakeFile = { filename: string; read: boolean };

const MISSING_ATTACHMENT =
  /didn'?t come through|did not come through|not come through|didn'?t (?:actually )?attach|did not attach|wasn'?t attached|was not attached|no attachment|attachment (?:is|was) missing|attachment (?:didn'?t|did not) arrive|please (?:re-?send|send (?:it|that|the \w+) again)|re-?send (?:the |it|that )?(?:file|attachment|spreadsheet|list|document)?/i;

export function claimsAttachmentMissing(text: string): boolean {
  return MISSING_ATTACHMENT.test(text);
}

/** Drop sentences that deny an attachment the records already stored. */
export function withoutMissingAttachmentClaims(text: string): string {
  const chunks = text.split(/\n+/);
  const kept = chunks.flatMap((chunk) => {
    const sentences = chunk.split(/(?<=[.!?])\s+/).filter((sentence) => sentence.trim());
    return sentences.filter((sentence) => !claimsAttachmentMissing(sentence));
  });
  return kept.join(" ").replace(/[ \t]{2,}/g, " ").trim();
}

function proposalCopy(proposal: Record<string, unknown>): string {
  return ["draft", "text", "title", "summary"]
    .map((key) => proposal[key])
    .filter((value): value is string => typeof value === "string" && value.trim().length > 0)
    .join(" ");
}

function isCoparentReply(proposal: Record<string, unknown>): boolean {
  const type = typeof proposal.type === "string" ? proposal.type : "";
  if (type === "reply_coparent") return true;
  if (type !== "ask_clarification") return false;
  return proposal.audience !== "parent";
}

/**
 * Stored files decide whether an attachment arrived.
 * The user's own intake never becomes a co-parent reply or a filing.
 */
export function correctIntakeProposals<T>(
  proposals: T[],
  input: { storedFileNames: string[]; ownMessage: boolean }
): { proposals: T[]; changed: boolean } {
  const stored = input.storedFileNames.map((name) => name.trim()).filter(Boolean);
  let changed = false;
  const next = proposals.map((raw) => {
    if (!raw || typeof raw !== "object") return raw;
    const proposal = raw as Record<string, unknown>;
    const status = typeof proposal.status === "string" ? proposal.status.toLowerCase() : "";
    if (status === "dismissed" || status === "superseded" || status === "waived_by_user") return raw;
    const type = typeof proposal.type === "string" ? proposal.type : "";
    const ownFiling = input.ownMessage && type === "log_document";
    const ownReply = input.ownMessage && isCoparentReply(proposal);
    const staleReply =
      stored.length > 0 &&
      isCoparentReply(proposal) &&
      claimsAttachmentMissing(proposalCopy(proposal));
    if (!ownFiling && !ownReply && !staleReply) return raw;
    changed = true;
    return { ...proposal, status: "dismissed" } as T;
  });
  return { proposals: next, changed };
}

export function correctIntakeText(
  text: string,
  input: { stored: StoredIntakeFile[]; failed?: AttachmentNotice[]; ownMessage: boolean }
): string {
  const facts = sageAttachmentSentences({
    saved: input.stored,
    failed: input.failed ?? [],
  });
  if (input.ownMessage) {
    const saved = facts || "I saved that email for you.";
    return `${saved} Nothing has been filed or sent.`.replace(/\s+/g, " ").trim();
  }
  const cleaned = input.stored.length > 0 ? withoutMissingAttachmentClaims(text) : text.trim();
  if (!facts) return cleaned;
  if (cleaned.includes(facts)) return cleaned;
  const named = input.stored.every((file) => cleaned.includes(file.filename));
  if (named && !claimsAttachmentMissing(cleaned)) return cleaned;
  return [cleaned, facts].filter(Boolean).join(" ");
}

export function senderIsAccountOwner(input: {
  senderId?: string | null;
  senderEmail?: string | null;
  ownerId: string;
  ownerEmails: string[];
}): boolean {
  if (input.senderId && input.senderId === input.ownerId) return true;
  const email = (input.senderEmail ?? "").trim().toLowerCase();
  if (!email) return false;
  return input.ownerEmails.some((owner) => owner.trim().toLowerCase() === email);
}
