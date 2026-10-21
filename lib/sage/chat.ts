/**
 * Talk-to-Sage chat adapter — Observation → processObservation → reply + actions.
 * Propose only; does not execute tools or write sage_items.
 */

import {
  routeChatIntent,
  type ChatControl,
  type KnownCoparent,
  type PendingRevision,
} from "@/lib/sage/chat-intent";
import type { CaseEvent, KnownChild } from "@/lib/sage/calendar-chat";
import type { ConversationContext } from "@/lib/sage/conversation-context";
import { buildObservationFromChat } from "@/lib/sage/observation-builder";
import {
  processObservation,
  type ProcessObservationResult,
} from "@/lib/sage/process-observation";
import { attachExpenseSharing } from "@/lib/sage/attach-expense-sharing";
import { isCalendarUpdateProposal, isLogExpenseProposal } from "@/lib/sage/proposal-kind";
import type { Proposal } from "@/lib/sage/planner";

export type { ChatControl, PendingRevision };

export type ChatAction = Proposal & { status: "proposed" };

export type ChatProcessResult = {
  reply: string;
  actions: ChatAction[];
  result: ProcessObservationResult;
  control: ChatControl;
  revision: PendingRevision | null;
};

export type ProcessChatMessageInput = {
  message: string;
  case_id: string;
  timezone: string;
  /** Journal message UUID — used as Observation / processObservation source_id. */
  source_id?: string;
  /** Compact thread context. Replaces carrying a date forward on its own. */
  conversation?: ConversationContext | null;
  /** Other parents on the case. Pronouns resolve only when this list has one person. */
  coparents?: KnownCoparent[];
  children?: KnownChild[];
  events?: CaseEvent[];
  viewerId?: string;
  /** self_forward holds the email privately and does not propose an action. */
  intake?: "chat" | "self_forward";
  today?: Date;
};

function buildReply(result: ProcessObservationResult): string {
  const { plan } = result;
  const ask = plan.proposals.find((p) => p.type === "ask_clarification");
  if (plan.status === "awaiting_clarification" && ask?.draft?.trim()) {
    return ask.draft.trim();
  }
  if (plan.proposals.some((p) => isCalendarUpdateProposal(p.type))) {
    return "I can do that.";
  }
  if (plan.proposals.some((p) => isLogExpenseProposal(p.type))) {
    return "I can log that.";
  }
  if (plan.proposals.some((p) => p.type === "reply_coparent")) {
    return "I can draft that for Co-Parent.";
  }
  if (plan.proposals.some((p) => p.type === "note_only")) {
    return "Got it — noted.";
  }
  return "I can help with that.";
}

/**
 * Run a typed chat message through the shared Sage engine (single-intent).
 */
export async function processChatMessage(
  input: ProcessChatMessageInput
): Promise<ChatProcessResult> {
  const routed = routeChatIntent({
    message: input.message,
    conversation: input.conversation ?? null,
    coparents: input.coparents ?? [],
    children: input.children ?? [],
    events: input.events ?? [],
    viewerId: input.viewerId,
    intake: input.intake ?? "chat",
    timezone: input.timezone,
    today: input.today,
  });
  if (routed.handled) {
    const shared = await shareExpenseTurn(input.case_id, routed.reply, routed.result);
    return {
      reply: shared.reply,
      actions: shared.proposals.map((p) => ({ ...p, status: "proposed" as const })),
      result: routed.result,
      control: routed.control,
      revision: routed.revision,
    };
  }

  const observation = buildObservationFromChat(input.message, {
    id: input.source_id,
  });
  const result = await processObservation(observation, {
    case_id: input.case_id,
    timezone: input.timezone,
    source_type: "chat",
    source_id: input.source_id ?? observation.target_id,
    sender: "You",
    plan_sender: "You",
    conversation: input.conversation ?? null,
  });

  const shared = await shareExpenseTurn(input.case_id, buildReply(result), result);
  const actions: ChatAction[] = shared.proposals.map((p) => ({
    ...p,
    status: "proposed" as const,
  }));

  return {
    reply: shared.reply,
    actions,
    result,
    control: "none",
    revision: null,
  };
}

async function shareExpenseTurn(
  caseId: string,
  reply: string,
  result: ProcessObservationResult
): Promise<{ reply: string; proposals: Proposal[] }> {
  const fallbackAmount = result.interpretation.entities.amounts.find(
    (amount) => typeof amount.value === "number" && amount.value > 0
  )?.value;
  const shared = await attachExpenseSharing({
    caseId,
    proposals: result.plan.proposals,
    childId: result.child_ids[0] ?? null,
    reply,
    fallbackAmount: typeof fallbackAmount === "number" ? fallbackAmount : null,
    fallbackCategory: result.expense_category ?? null,
  });
  result.plan.proposals = shared.proposals;
  if (shared.status) result.plan.status = shared.status;
  return { reply: shared.reply, proposals: shared.proposals };
}
