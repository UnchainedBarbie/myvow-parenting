import type { MessageIntakeEvidence, StoredIntakeDocument } from "@/lib/messages/intake-evidence";
import {
  correctIntakeProposals,
  correctIntakeText,
  senderIsAccountOwner,
} from "@/lib/sage/intake-facts";
import { filesForMessages, sageAttachmentViews, type SageAttachmentView } from "@/lib/sage/message-attachments";

type Proposal = Record<string, unknown>;

export type StoredIntakeCorrection = {
  ownMessage: boolean;
  content: string;
  summary: string;
  proposals: Proposal[];
  proposalsChanged: boolean;
  summaryChanged: boolean;
  attachments: SageAttachmentView[];
  /** The message and its stored files stay. This correction never deletes them. */
  preserved: { messageIds: string[]; documentIds: string[]; statuses: (string | null)[] };
};

function activeReply(proposals: Proposal[]): boolean {
  return proposals.some((proposal) => {
    const status = typeof proposal.status === "string" ? proposal.status.toLowerCase() : "";
    return proposal.type === "reply_coparent" && status !== "dismissed" && status !== "superseded";
  });
}

function withoutReadyReply(text: string, proposals: Proposal[]): string {
  if (activeReply(proposals)) return text;
  return text.replace(/\s*A reply is ready for you to review\.?/gi, " ").replace(/\s{2,}/g, " ").trim();
}

/**
 * Reclassify one already-saved Sage turn from the stored message and its files.
 * A turn is the viewer's own only when every linked message belongs to them,
 * so a real co-parent message on the same turn is left alone.
 */
export function correctStoredIntakeTurn(input: {
  content: string;
  summary: string;
  proposals: Proposal[];
  linkedMessageIds: string[];
  evidence: Map<string, MessageIntakeEvidence>;
  ownerId: string;
  ownerEmails: string[];
  viewer: { userId: string; role: string | null };
}): StoredIntakeCorrection {
  const sources = input.linkedMessageIds
    .map((id) => input.evidence.get(id))
    .filter((source): source is MessageIntakeEvidence => Boolean(source));
  const ownMessage =
    sources.length > 0 &&
    sources.every((source) =>
      senderIsAccountOwner({
        senderId: source.senderId,
        senderEmail: source.senderEmail,
        senderEmails: source.senderEmails,
        ownerId: input.ownerId,
        ownerEmails: input.ownerEmails,
      })
    );
  const files = filesForMessages(input.linkedMessageIds, input.evidence);
  const corrected = correctIntakeProposals(input.proposals, {
    storedFileNames: files.map((file) => file.filename),
    ownMessage,
  });
  const stored = files.map((file) => ({ filename: file.filename, read: file.read }));
  let content = correctIntakeText(input.content, { stored, ownMessage });
  content = withoutReadyReply(content, corrected.proposals);
  let summary = input.summary
    ? correctIntakeText(input.summary, { stored, ownMessage })
    : "";
  summary = withoutReadyReply(summary, corrected.proposals);
  return {
    ownMessage,
    content,
    summary,
    proposals: corrected.proposals,
    proposalsChanged: corrected.changed,
    summaryChanged: summary !== input.summary,
    attachments: sageAttachmentViews(files, input.viewer),
    preserved: {
      messageIds: [...input.linkedMessageIds],
      documentIds: files.map((file) => file.id),
      statuses: files.map((file) => file.status),
    },
  };
}

export type { StoredIntakeDocument };
