/**
 * Talk-to-Sage chat adapter — Observation → processObservation → reply + actions.
 * Propose only; does not execute tools or write sage_items.
 */

import { buildObservationFromChat } from "@/lib/sage/observation-builder";
import {
  processObservation,
  type ProcessObservationResult,
} from "@/lib/sage/process-observation";
import { isCalendarUpdateProposal, isLogExpenseProposal } from "@/lib/sage/proposal-kind";
import type { Proposal } from "@/lib/sage/planner";

export type ChatAction = Proposal & { status: "proposed" };

export type ChatProcessResult = {
  reply: string;
  actions: ChatAction[];
  result: ProcessObservationResult;
};

export type ProcessChatMessageInput = {
  message: string;
  case_id: string;
  timezone: string;
  /** Journal message UUID — used as Observation / processObservation source_id. */
  source_id?: string;
  /** Optional conversation metadata (unused in v1 single-intent). */
  conversation_context?: unknown;
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
  });

  const actions: ChatAction[] = result.plan.proposals.map((p) => ({
    ...p,
    status: "proposed" as const,
  }));

  return {
    reply: buildReply(result),
    actions,
    result,
  };
}
