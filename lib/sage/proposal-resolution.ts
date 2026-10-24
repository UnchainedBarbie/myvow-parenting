import type { SageProposal } from "@/components/sage/proposal-types";
import {
  isCalendarUpdateProposal,
  isFormExecuteProposal,
  isLogDocumentProposal,
  isLogExpenseProposal,
} from "@/lib/sage/proposal-kind";
import { isSupersededProposal, type ProposalRecord } from "@/lib/sage/proposal-lifecycle";

/**
 * A proposal leaves Open items only when this specific proposal is resolved.
 * An approved reply draft is not a sent reply. A newer message in the same
 * conversation is not a link. Calendar update targets are not execution results.
 */

const CLOSED_STATUS = new Set([
  "waived_by_user",
  "declined",
  "canceled",
  "cancelled",
  "dismissed",
  "superseded",
  "completed",
]);

export type SentReplyLink = {
  proposalId: string;
  messageId: string;
};

export function isMessageReplyProposal(proposal: { type?: string | null }): boolean {
  return (proposal.type ?? "").trim() === "reply_coparent";
}

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function statusOf(proposal: { status?: unknown }): string {
  return text(proposal.status).toLowerCase();
}

export function isSaveFailedProposal(proposal: {
  status?: unknown;
  save_error?: unknown;
}): boolean {
  if (statusOf(proposal) === "save_failed") return true;
  return text(proposal.save_error).length > 0;
}

export function storedMessageId(proposal: { result_message_id?: unknown }): string {
  return text(proposal.result_message_id);
}

/** The proposal records a saved message id. Approval, or a sent flag without that id, is not enough. */
export function replyWasSent(
  proposal: {
    type?: string | null;
    executed?: boolean;
    result_message_id?: unknown;
    delivery_status?: unknown;
  },
  sentMessageIds?: ReadonlySet<string>
): boolean {
  if (!isMessageReplyProposal(proposal)) return false;
  const messageId = storedMessageId(proposal);
  if (!messageId) return false;
  if (sentMessageIds && !sentMessageIds.has(messageId)) return false;
  return true;
}

function resultId(proposal: ProposalRecord, key: string): string {
  return text(proposal[key]);
}

/**
 * True when this proposal should disappear from Open items.
 * Message replies stay open after approval until a send link or execution flag exists.
 */
export function isResolvedProposal(
  proposal: SageProposal,
  sentMessageIds?: ReadonlySet<string>
): boolean {
  if (proposal.type === "note_only" || isSupersededProposal(proposal)) return true;
  const status = statusOf(proposal);
  if (CLOSED_STATUS.has(status)) return true;
  if (isSaveFailedProposal(proposal)) return false;

  if (isCalendarUpdateProposal(proposal.type)) {
    return (
      (proposal.executed === true && text(proposal.result_event_id).length > 0) ||
      text(proposal.result_event_id).length > 0
    );
  }
  if (isLogExpenseProposal(proposal.type)) {
    return proposal.executed === true || text(proposal.result_expense_id).length > 0;
  }
  if (isLogDocumentProposal(proposal.type)) {
    return proposal.executed === true || text(proposal.result_document_id).length > 0;
  }
  if (isFormExecuteProposal(proposal.type)) {
    return proposal.executed === true;
  }
  if (isMessageReplyProposal(proposal)) {
    return replyWasSent(proposal, sentMessageIds);
  }
  if (proposal.executed === true) return true;
  if (proposal.approved === true || status === "approved") return true;
  if (text(proposal.approved_at).length > 0) return true;
  return false;
}

function asRecord(raw: unknown): ProposalRecord | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  return { ...(raw as ProposalRecord) };
}

/**
 * Persist resolution that is already proven by ids and flags on this proposal,
 * or by an outgoing message row that names this proposal id.
 * A second call makes no changes. Unlinked proposals are left pending.
 */
export function reconcileResolvedProposals(
  proposals: unknown[],
  links: SentReplyLink[] = [],
  now = new Date().toISOString()
): { proposals: ProposalRecord[]; changed: boolean } {
  const next = proposals.map((raw) => asRecord(raw) ?? {});
  let changed = false;
  const linkByProposal = new Map<string, string>();
  for (const link of links) {
    const proposalId = link.proposalId.trim();
    const messageId = link.messageId.trim();
    if (!proposalId || !messageId || linkByProposal.has(proposalId)) continue;
    linkByProposal.set(proposalId, messageId);
  }

  for (let index = 0; index < next.length; index += 1) {
    const proposal = next[index];
    if (isSupersededProposal(proposal) || isSaveFailedProposal(proposal)) continue;
    const status = statusOf(proposal);
    if (CLOSED_STATUS.has(status)) continue;

    const proposalId = text(proposal.id);
    const linkedMessageId = proposalId ? linkByProposal.get(proposalId) ?? "" : "";
    if (isMessageReplyProposal(proposal) && linkedMessageId && text(proposal.result_message_id) !== linkedMessageId) {
      next[index] = {
        ...proposal,
        result_message_id: linkedMessageId,
        executed: true,
        executed_at: text(proposal.executed_at) || now,
        status: "completed",
      };
      changed = true;
      continue;
    }

    if (isMessageReplyProposal(proposal)) {
      if (!replyWasSent(proposal) || proposal.executed === true) continue;
      next[index] = {
        ...proposal,
        executed: true,
        executed_at: text(proposal.executed_at) || now,
        status: "completed",
      };
      changed = true;
      continue;
    }

    if (isCalendarUpdateProposal(text(proposal.type))) {
      const eventId = resultId(proposal, "result_event_id");
      if (!eventId || proposal.executed === true) continue;
      next[index] = {
        ...proposal,
        executed: true,
        executed_at: text(proposal.executed_at) || now,
        status: "completed",
      };
      changed = true;
      continue;
    }

    if (isLogExpenseProposal(text(proposal.type)) || isLogDocumentProposal(text(proposal.type))) {
      const saved =
        resultId(proposal, "result_expense_id") || resultId(proposal, "result_document_id");
      if (!saved || proposal.executed === true) continue;
      next[index] = {
        ...proposal,
        executed: true,
        executed_at: text(proposal.executed_at) || now,
        status: "completed",
      };
      changed = true;
      continue;
    }

    const approved =
      proposal.approved === true || status === "approved" || text(proposal.approved_at).length > 0;
    if (!approved || isMessageReplyProposal(proposal)) continue;
    next[index] = {
      ...proposal,
      approved: true,
      approved_at: text(proposal.approved_at) || now,
      status: "completed",
    };
    changed = true;
  }

  return { proposals: next, changed };
}

/** No further action. Does not approve, send, or remove stored record ids. */
export function dismissProposalRecord(proposal: ProposalRecord, now: string): ProposalRecord {
  if (statusOf(proposal) === "waived_by_user") return proposal;
  return {
    ...proposal,
    status: "waived_by_user",
    waived_at: text(proposal.waived_at) || now,
  };
}
