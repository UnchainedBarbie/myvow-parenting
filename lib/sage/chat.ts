/**
 * Talk-to-Sage chat adapter — Observation → processObservation → reply + actions.
 * Propose only; does not execute tools or write sage_items.
 */

import {
  anthropicConversationModel,
  buildConversationPacket,
  type ConversationModel,
} from "@/lib/sage/conversation-reply";
import {
  messageAnswerCandidate,
  routeChatIntent,
  type ChatControl,
  type KnownCoparent,
  type PendingRevision,
} from "@/lib/sage/chat-intent";
import type { CaseEvent, KnownChild } from "@/lib/sage/calendar-chat";
import type { SearchableDocument } from "@/lib/sage/document-search";
import type { ConversationContext } from "@/lib/sage/conversation-context";
import { buildObservationFromChat } from "@/lib/sage/observation-builder";
import {
  processObservation,
  type ProcessObservationResult,
} from "@/lib/sage/process-observation";
import { attachExpenseSharing } from "@/lib/sage/attach-expense-sharing";
import { isCalendarUpdateProposal, isLogExpenseProposal } from "@/lib/sage/proposal-kind";
import type { Proposal } from "@/lib/sage/planner";
import { settleParentChatPlan } from "@/lib/sage/working-memory";
import { scheduleShadowComparison } from "@/lib/sage/shadow-interpreter";
import {
  analysisObservationResult,
  performDocumentAnalysis,
  type AnalysisFile,
} from "@/lib/sage/document-analysis";
import { reasonWithModel, type ReasonPacket } from "@/lib/sage/document-reason";

export type { ChatControl, PendingRevision };

export type ChatAction = Proposal & { status: "proposed" };

export type ChatProcessResult = {
  reply: string;
  actions: ChatAction[];
  result: ProcessObservationResult;
  control: ChatControl;
  revision: PendingRevision | null;
  /** Proposal id of the open question this turn answered, when the router read one. */
  answers?: string | null;
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
  documents?: SearchableDocument[];
  viewerId?: string;
  viewerRole?: string | null;
  /** self_forward holds the email privately and does not propose an action. */
  intake?: "chat" | "self_forward";
  today?: Date;
  /** File name and id only. The shadow interpreter never receives the file URL. */
  attachments?: { id: string; fileName: string }[];
  /** Metadata for files already in reach. Bytes load only after an explicit read request. */
  analysisFiles?: AnalysisFile[];
  loadAnalysisBytes?: (file: AnalysisFile) => Promise<Buffer | null>;
  extractPdf?: (buffer: Buffer) => Promise<string>;
  recentTurns?: { role: "parent" | "sage"; text: string }[];
  /**
   * Answers a document question from extracted text.
   * Undefined uses the model when configured. Null keeps the local answer.
   */
  reasonAboutDocument?: ((packet: ReasonPacket) => Promise<string | null>) | null;
  /** Attachment processing schedules its own shadow call for the same journal row. */
  shadow?: boolean;
  /**
   * Writes the reply when a turn needs no structured action, and reads a turn against an open question.
   * Undefined uses the model when configured. Null keeps the safe fallback and the existing slot filling.
   * The model produces text only.
   */
  conversationModel?: ConversationModel | null;
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
  const read = await performDocumentAnalysis({
    message: input.message,
    files: input.analysisFiles ?? [],
    viewer: { userId: input.viewerId ?? "", role: input.viewerRole },
    caseId: input.case_id,
    loadBytes: input.loadAnalysisBytes ?? (async () => null),
    extractPdf: input.extractPdf,
    recentTurns: input.recentTurns,
    reason: input.reasonAboutDocument === null ? undefined : (input.reasonAboutDocument ?? reasonWithModel),
  });
  if (read) {
    const result = analysisObservationResult(read.reply, read.fileName, input.source_id);
    scheduleReadShadow(input, "I read the requested document.", result.plan.reasoning);
    return {
      reply: read.reply,
      actions: [],
      result,
      control: "none",
      revision: null,
    };
  }
  const chatTurn = (input.intake ?? "chat") === "chat";
  const model = input.conversationModel === undefined ? anthropicConversationModel() : input.conversationModel;
  const packet = () =>
    buildConversationPacket({
      message: input.message,
      recentTurns: input.recentTurns,
      conversation: input.conversation,
      children: input.children,
      coparents: input.coparents,
    });
  // Free text is the answer to an open message question only when the parent is answering it.
  let taskTurn: "conversation" | undefined;
  if (chatTurn && model && messageAnswerCandidate(input.message, input.conversation?.memory)) {
    const reading = await model.readTurn(packet()).catch(() => null);
    if (reading === "other") taskTurn = "conversation";
  }
  const routed = routeChatIntent({
    message: input.message,
    taskTurn,
    conversation: input.conversation ?? null,
    coparents: input.coparents ?? [],
    children: input.children ?? [],
    events: input.events ?? [],
    documents: input.documents ?? [],
    viewerId: input.viewerId,
    viewerRole: input.viewerRole,
    intake: input.intake ?? "chat",
    timezone: input.timezone,
    today: input.today,
  });
  if ((input.intake ?? "chat") === "chat" && input.shadow !== false) {
    const coparentName = input.coparents?.length === 1 ? input.coparents[0].name.trim().split(/\s+/)[0] : "";
    const coparent = coparentName && !coparentName.includes("@") ? coparentName : null;
    scheduleShadowComparison({
      message: input.message,
      recentTurns: input.recentTurns,
      memory: input.conversation?.memory ?? null,
      children: input.children ?? [],
      events: input.events ?? [],
      documents: input.documents ?? [],
      attachments: input.attachments,
      viewerId: input.viewerId,
      viewerRole: input.viewerRole,
      coparentName: coparent,
      turnKey: input.source_id,
      router: {
        handled: routed.handled,
        control: routed.control,
        reply: routed.reply,
        reasoning: routed.result.plan.reasoning,
        proposals: routed.result.plan.proposals,
      },
    });
  }
  if (routed.handled) {
    const shared = await shareExpenseTurn(input.case_id, routed.reply, routed.result);
    return {
      reply: shared.reply,
      actions: shared.proposals.map((p) => ({ ...p, status: "proposed" as const })),
      result: routed.result,
      control: routed.control,
      revision: routed.revision,
      answers: routed.answers ?? null,
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

  if ((input.intake ?? "chat") === "chat") {
    const settled = settleParentChatPlan(result.plan, input.conversation?.memory ?? null);
    if (settled) {
      result.plan = settled.plan;
      // No action fits this turn. Sage answers the parent in words. Nothing is proposed or saved.
      const spoken = model ? await model.reply(packet()).catch(() => null) : null;
      return {
        reply: spoken?.trim() ? spoken.trim() : settled.reply,
        actions: [],
        result,
        control: "none",
        revision: null,
      };
    }
  }

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

function scheduleReadShadow(
  input: ProcessChatMessageInput,
  reply: string,
  reasoning: string
): void {
  if ((input.intake ?? "chat") !== "chat" || input.shadow === false) return;
  const coparentName = input.coparents?.length === 1 ? input.coparents[0].name.trim().split(/\s+/)[0] : "";
  const coparent = coparentName && !coparentName.includes("@") ? coparentName : null;
  scheduleShadowComparison({
    message: input.message,
    recentTurns: input.recentTurns,
    memory: input.conversation?.memory ?? null,
    children: input.children ?? [],
    events: input.events ?? [],
    documents: input.documents ?? [],
    attachments: (input.analysisFiles ?? []).map((file) => ({ id: file.id, fileName: file.fileName })),
    viewerId: input.viewerId,
    viewerRole: input.viewerRole,
    coparentName: coparent,
    turnKey: input.source_id,
    router: {
      handled: true,
      control: "none",
      reply,
      reasoning,
      proposals: [],
    },
  });
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
