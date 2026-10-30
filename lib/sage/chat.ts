/**
 * Talk-to-Sage chat adapter — Observation → processObservation → reply + actions.
 * Propose only; does not execute tools or write sage_items.
 */

import {
  anthropicConversationModel,
  buildConversationPacket,
  conversationFallbackReply,
  type ConversationModel,
} from "@/lib/sage/conversation-reply";
import {
  isMessageDraftRequest,
  messageAnswerCandidate,
  messageAskTurn,
  messageDraftTurn,
  routeChatIntent,
  type ChatControl,
  type KnownCoparent,
  type PendingRevision,
} from "@/lib/sage/chat-intent";
import { buildContextFrame, hasConversationSubstance, withInterpretation } from "@/lib/sage/context-frame";
import {
  anthropicConversationActionModel,
  decideConversationAction,
  interpretConversationTurn,
  type ConversationActionModel,
} from "@/lib/sage/conversation-action";
import { liveTaskById, whichOpenMessageQuestion } from "@/lib/sage/open-task";
import {
  anthropicArbitrationModel,
  arbitrateTurn,
  idleArbitration,
  type ArbitrationModel,
  type TurnArbitration,
} from "@/lib/sage/turn-arbitration";
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
  /** How this turn relates to an OpenTask. Unread means task state must not change. */
  taskDecision: TurnArbitration;
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
  /**
   * Reads a request against the conversation and drafts a message from it.
   * Undefined uses the model when configured. Null skips interpretation (tests of other paths).
   */
  conversationActionModel?: ConversationActionModel | null;
  /**
   * Reads this turn against live OpenTasks. Undefined uses the model when configured.
   * Null keeps the structural reading (tests of other paths).
   */
  arbitrationModel?: ArbitrationModel | null;
  sessionId?: string | null;
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
      taskDecision: idleArbitration(),
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
  const frame = buildContextFrame({
    parentId: input.viewerId ?? "",
    caseId: input.case_id,
    role: input.viewerRole ?? null,
    sessionId: input.sessionId ?? null,
    message: input.message,
    recentTurns: input.recentTurns,
    conversation: input.conversation ?? null,
    children: input.children,
    coparents: input.coparents,
  });
  const actionModel =
    input.conversationActionModel === undefined
      ? anthropicConversationActionModel()
      : input.conversationActionModel;
  const routedMessage = routed.result.plan.proposals.some((proposal) => proposal.type === "reply_coparent");
  const routedOtherAction = routed.result.plan.proposals.some(
    (proposal) =>
      proposal.type === "calendar_update" ||
      proposal.type === "log_expense" ||
      proposal.type === "log_document"
  );
  const shouldInterpret =
    chatTurn &&
    actionModel &&
    (routedMessage ||
      isMessageDraftRequest(input.message) ||
      (!routed.handled && hasConversationSubstance(frame)));
  const interpretation = shouldInterpret ? await interpretConversationTurn(frame, actionModel) : null;
  const framed = withInterpretation(frame, interpretation);
  const messageIntent =
    routedMessage ||
    isMessageDraftRequest(input.message) ||
    routed.result.plan.proposals.some(
      (proposal) => proposal.type === "ask_clarification" && proposal.clarifies === "message"
    );
  const arbitrationModel =
    input.arbitrationModel === undefined ? anthropicArbitrationModel() : input.arbitrationModel;
  const taskDecision = await arbitrateTurn(
    {
      frame: framed,
      tasks: frame.openTasks,
      interpretation,
      hasActionCard: routedMessage || routedOtherAction,
      messageIntent,
    },
    arbitrationModel
  );
  const applyAction =
    !taskDecision.unread &&
    taskDecision.relation !== "conversation" &&
    taskDecision.relation !== "cancel" &&
    taskDecision.relation !== "ask";
  const boundTask = liveTaskById(frame.openTasks, taskDecision.taskId);
  const framedForDraft =
    taskDecision.relation === "new_task"
      ? { ...framed, currentDrafts: [] as string[] }
      : boundTask?.outgoingBody
        ? { ...framed, currentDrafts: [boundTask.outgoingBody] }
        : framed;
  const actionDecision =
    shouldInterpret && applyAction
      ? await decideConversationAction({
          frame: framedForDraft,
          model: actionModel,
          conversation: input.conversation ?? null,
          routedMessage,
          messageIntent,
          routedOtherAction,
          skipInterpret: true,
          interpretation,
        })
      : null;
  if (
    applyAction &&
    actionDecision?.status === "draft" &&
    !(taskDecision.relation === "continue" && routedMessage)
  ) {
    Object.assign(
      routed,
      messageDraftTurn({
        message: input.message,
        recipient: actionDecision.recipient,
        body: actionDecision.body,
        outcome: actionDecision.interpretation.outcome,
        keep: routedOtherAction ? routed.result.plan.proposals : [],
        taskId: taskDecision.relation === "new_task" ? undefined : taskDecision.taskId ?? undefined,
      })
    );
  } else if (applyAction && actionDecision?.status === "ask" && !routedMessage) {
    Object.assign(
      routed,
      messageAskTurn({
        message: input.message,
        question: actionDecision.question,
        recipient: actionDecision.recipient,
        keep: routedOtherAction ? routed.result.plan.proposals : [],
      })
    );
  } else if (
    (actionDecision?.status === "unrelated" ||
      interpretation?.kind === "conversation" ||
      taskDecision.relation === "conversation" ||
      taskDecision.relation === "ask") &&
    routedMessage &&
    !routedOtherAction
  ) {
    routed.handled = false;
    routed.result.plan.proposals = [];
    routed.result.plan.status = "no_action";
  }
  if (taskDecision.relation === "ask") {
    routed.handled = false;
    routed.result.plan.proposals = [];
    routed.result.plan.status = "no_action";
  }
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
      taskDecision,
    };
  }

  if (
    taskDecision.unread ||
    taskDecision.relation === "conversation" ||
    taskDecision.relation === "cancel" ||
    taskDecision.relation === "ask"
  ) {
    const spoken =
      taskDecision.relation === "ask"
        ? whichOpenMessageQuestion(frame.openTasks)
        : model
          ? await model.reply(packet()).catch(() => null)
          : null;
    const observation = buildObservationFromChat(input.message, { id: input.source_id });
    return {
      reply:
        taskDecision.relation === "ask"
          ? whichOpenMessageQuestion(frame.openTasks)
          : spoken?.trim()
            ? spoken.trim()
            : conversationFallbackReply(input.conversation?.memory?.clarification?.question),
      actions: [],
      result: {
        observation,
        interpretation: {
          intent: {
            item_type: "information_only",
            domain: "general",
            summary: input.message.trim().slice(0, 120),
            evidence_excerpt: "",
            tool_name: null,
            action_required: false,
            action_type: null,
            urgency: "normal",
            confidence: 1,
          },
          entities: {
            children: [],
            people: [],
            dates: [],
            amounts: [],
            merchants: [],
            providers: [],
            documents: [],
          },
          reasoning: { signals: [] },
        },
        child_ids: [],
        unresolved_children: [],
        resolved_dates: [],
        plan: {
          status: "no_action",
          proposals: [],
          reasoning: "This turn does not change an OpenTask.",
        },
      },
      control: "none",
      revision: null,
      taskDecision,
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
        taskDecision,
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
    taskDecision,
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
