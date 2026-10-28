import { reviewProofForSend, type ReviewedDraft } from "@/lib/messages/outbound-review";
import { ATTACHMENT_NOT_SHAREABLE_CODE } from "@/lib/messages/send-safety";

/**
 * What the browser sends when a parent approves a Sage message card.
 * The card is reviewed first. The request carries the exact approved text and proof of the review.
 */

export type ProposalSendRequest = {
  reviewedMessage: {
    proposal_index: number;
    text: string;
    review_receipt?: string;
    review_unavailable_ack?: true;
    edit_unreviewed_ack?: true;
  };
  acknowledgeAttachmentOmission: boolean;
};

export type SendOutcome =
  | { ok: true }
  | { ok: false; error: string; code?: string };

type MessageProposal = {
  type?: string;
  draft?: string | null;
  revised_text?: string | null;
  recipient_email?: string | null;
  executed?: boolean;
  result_message_id?: string | null;
};

/** The text a card shows and the review starts from. Matches what the server treats as the draft. */
export function proposalMessageText(p: MessageProposal): string {
  return (p.revised_text ?? "").trim() || (p.draft ?? "").trim();
}

/** A card that sends a message to the co-parent when approved. */
export function isSendableMessageProposal(p: MessageProposal | null | undefined): boolean {
  if (!p || p.type !== "reply_coparent") return false;
  if (!(p.recipient_email ?? "").trim()) return false;
  return p.executed !== true && !(p.result_message_id ?? "").trim();
}

export function buildProposalSendRequest(input: {
  proposalIndex: number;
  finalText: string;
  reviewed: ReviewedDraft;
  acknowledgeAttachmentOmission?: boolean;
  /** The parent chose to send an edit Sage has not read. */
  editUnreviewedAck?: boolean;
}): ProposalSendRequest {
  const proof = reviewProofForSend(input.reviewed, { editUnreviewedAck: input.editUnreviewedAck });
  return {
    reviewedMessage: {
      proposal_index: input.proposalIndex,
      text: input.finalText,
      ...proof,
    },
    acknowledgeAttachmentOmission: input.acknowledgeAttachmentOmission === true,
  };
}

/** Fields added to the sage-inbox agree request. Empty for every card that is not a reviewed send. */
export function sendRequestFields(send: ProposalSendRequest | undefined): Record<string, unknown> {
  if (!send) return {};
  const m = send.reviewedMessage;
  return {
    reviewed_message: {
      proposal_index: m.proposal_index,
      text: m.text,
      receipt: m.review_receipt ?? null,
      unavailable_ack: m.review_unavailable_ack === true,
      edit_unreviewed_ack: m.edit_unreviewed_ack === true,
    },
    ...(send.acknowledgeAttachmentOmission ? { acknowledge_attachment_omission: true } : {}),
  };
}

export function sendOutcomeFromResponse(
  res: { ok: boolean },
  data: { error?: string; code?: string } | null
): SendOutcome {
  if (res.ok) return { ok: true };
  return {
    ok: false,
    error: data?.error?.trim() || "The message was not sent.",
    ...(data?.code ? { code: data.code } : {}),
  };
}

export function isAttachmentBlock(outcome: SendOutcome | void | undefined): outcome is {
  ok: false;
  error: string;
  code: string;
} {
  return Boolean(outcome && outcome.ok === false && outcome.code === ATTACHMENT_NOT_SHAREABLE_CODE);
}
