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
import type { ConversationContext } from "@/lib/sage/conversation-context";
import { buildObservationFromChat } from "@/lib/sage/observation-builder";
import {
  processObservation,
  type ProcessObservationResult,
} from "@/lib/sage/process-observation";
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
    intake: input.intake ?? "chat",
    timezone: input.timezone,
    today: input.today,
  });
  if (routed.handled) {
    return {
      reply: routed.reply,
      actions: routed.result.plan.proposals.map((p) => ({ ...p, status: "proposed" as const })),
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

  const actions: ChatAction[] = result.plan.proposals.map((p) => ({
    ...p,
    status: "proposed" as const,
  }));

  return {
    reply: buildReply(result),
    actions,
    result,
    control: "none",
    revision: null,
  };
}
