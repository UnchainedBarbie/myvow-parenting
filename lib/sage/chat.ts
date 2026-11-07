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
  messageSelectionTurn,
  routeChatIntent,
  type ChatControl,
  type KnownCoparent,
  type PendingRevision,
} from "@/lib/sage/chat-intent";
import { alignCalendarRows } from "@/lib/sage/calendar-chat";
import { buildContextFrame, hasConversationSubstance, relevantParentFacts, withInterpretation } from "@/lib/sage/context-frame";
import { isParentFacingCopy, NO_DETAIL_REPLY, requestAsDraft, usableOutboundBody } from "@/lib/sage/outbound-facts";
import {
  anthropicConversationActionModel,
  decideConversationAction,
  interpretConversationTurn,
  type ConversationActionModel,
} from "@/lib/sage/conversation-action";
import {
  liveMessageChoices,
  liveTaskById,
  liveTasksOfKind,
  objectiveForContinuity,
  whichOpenMessageQuestion,
  type OpenTask,
} from "@/lib/sage/open-task";
import {
  continueEstablishedObjective,
  mergeObjective,
  objectiveFromParts,
  parseSelectionAnswer,
} from "@/lib/sage/task-objective";
import {
  anthropicArbitrationModel,
  arbitrateTurn,
  askArbitration,
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
import { settleParentChatPlan, type WorkingMemory } from "@/lib/sage/working-memory";
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
  /**
   * Set when a message draft fails review, the repair fails, and the body cannot be sent.
   * Only that message task's stored objective is cleared. Other work stays.
   */
  clearMessageObjective: { taskId: string } | null;
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
  /** Older parent-authored turns that still belong to this discussion. */
  parentContext?: string[];
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
    return "I can draft that for your co-parent.";
  }
  if (plan.proposals.some((p) => p.type === "note_only")) {
    return "Got it — noted.";
  }
  return "I can help with that.";
}

/** Drop a co-parent card whose body is the parent's private request. The previous draft is left alone. */
function releaseRawRequest(
  input: ProcessChatMessageInput,
  reply: string,
  proposals: Proposal[]
): { reply: string; proposals: Proposal[]; released: boolean } {
  const liveDraft = (input.conversation?.open_proposals ?? []).some(
    (item) => item.type === "reply_coparent" && item.text.trim().length > 0
  );
  const raw = proposals.filter((item) => {
    if (item.type === "reply_coparent") {
      const draft = item.draft ?? "";
      return (
        requestAsDraft(draft, input.message) ||
        isParentFacingCopy(draft) ||
        (liveDraft && draft.trim() === NO_DETAIL_REPLY)
      );
    }
    return item.type === "ask_clarification" && item.clarifies === "message" && isParentFacingCopy(item.draft ?? "");
  });
  if (raw.length === 0) return { reply, proposals, released: false };
  const kept = proposals.filter((item) => !raw.includes(item));
  return {
    released: true,
    proposals: kept,
    reply: kept.some((item) => item.type === "reply_coparent")
      ? reply
      : liveDraft
        ? "That revision did not work. The draft is unchanged."
        : isParentFacingCopy(reply)
          ? reply
          : "I couldn't draft that. What should the message say?",
  };
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
      clearMessageObjective: null,
    };
  }
  let clearMessageObjective: { taskId: string } | null = null;
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
  // Free text becomes the message only after a reading says the parent is answering the open question.
  // A missing or failed reading produces no draft.
  let taskTurn: "conversation" | "unreadable" | undefined;
  if (chatTurn && messageAnswerCandidate(input.message, input.conversation?.memory)) {
    if (!model) {
      taskTurn = "unreadable";
    } else {
      const reading = await model.readTurn(packet()).catch(() => null);
      if (reading === "other") taskTurn = "conversation";
      else if (reading !== "answers_pending_question") taskTurn = "unreadable";
    }
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
  // A turn the router already resolved is not arbitrated. control is the signal.
  // handled alone is not: a draft request is handled with a placeholder the conversation still replaces.
  // cancel_message still closes every open reply in the session. That is the existing
  // session control. This path does not add another choice among drafts.
  const routerResolved = routed.control !== "none";
  const frame = buildContextFrame({
    parentId: input.viewerId ?? "",
    caseId: input.case_id,
    role: input.viewerRole ?? null,
    sessionId: input.sessionId ?? null,
    message: input.message,
    recentTurns: input.recentTurns,
    parentContext: input.parentContext,
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
  const pendingSelection = liveMessageChoices(
    input.conversation?.memory?.clarification?.selectionOptions ?? [],
    frame.openTasks
  );
  const selectionSpan = pendingSelection.reduce((max, option) => Math.max(max, option.index), 0);
  const pickedIndex = selectionSpan > 0 ? parseSelectionAnswer(input.message, selectionSpan) : null;
  const picked = pickedIndex != null ? pendingSelection.find((option) => option.index === pickedIndex) ?? null : null;
  const pickedTask = picked ? liveTaskById(frame.openTasks, picked.taskId) : null;
  const shouldInterpret =
    !routerResolved &&
    chatTurn &&
    actionModel &&
    !pickedTask &&
    (routedMessage ||
      isMessageDraftRequest(input.message) ||
      (!routed.handled && hasConversationSubstance(frame)));
  const interpretation = pickedTask
    ? {
        kind: "message" as const,
        outcome: pickedTask.groundedIn?.outcome || pickedTask.privateObjective || "Revise the selected message.",
        question: pickedTask.groundedIn?.question ?? null,
        refersTo: pickedTask.groundedIn?.question ?? null,
        grounding: "conversation" as const,
        relevantFactIndexes: pickedTask.groundedIn?.turns ?? [],
        uncertain: pickedTask.groundedIn?.uncertain ?? [],
        disputed: [] as string[],
        recipientName: frame.coparents[0]?.name ?? null,
        elicitation: "open_question" as const,
        privateConstraints: pickedTask.groundedIn?.private_constraints ?? [],
      }
    : shouldInterpret
      ? await interpretConversationTurn(frame, actionModel)
      : null;
  const framed = withInterpretation(frame, interpretation);
  const messageIntent =
    routedMessage ||
    isMessageDraftRequest(input.message) ||
    !!pickedTask ||
    routed.result.plan.proposals.some(
      (proposal) => proposal.type === "ask_clarification" && proposal.clarifies === "message"
    );
  const arbitrationModel =
    input.arbitrationModel === undefined ? anthropicArbitrationModel() : input.arbitrationModel;
  let taskDecision: TurnArbitration = routerResolved
    ? idleArbitration()
    : pickedTask
    ? {
        relation: "revise",
        taskId: pickedTask.id,
        currentProposalId: pickedTask.currentProposalId,
        currentItemId: pickedTask.currentItemId,
        kind: pickedTask.kind,
        unread: false,
      }
    : picked
      ? askArbitration()
      : await arbitrateTurn(
          {
            frame: framed,
            tasks: frame.openTasks,
            interpretation,
            hasActionCard: routedMessage || routedOtherAction,
            messageIntent,
          },
          arbitrationModel
        );
  if (
    !routerResolved &&
    pendingSelection.length > 1 &&
    !picked &&
    !taskDecision.separate &&
    (taskDecision.relation === "new_task" ||
      taskDecision.relation === "revise" ||
      taskDecision.relation === "continue") &&
    (messageIntent || interpretation?.kind === "message" || taskDecision.kind === "message")
  ) {
    taskDecision = askArbitration();
  }
  if (!routerResolved && routed.control === "cancel_message") {
    const openMessages = liveTasksOfKind(frame.openTasks, "message");
    if (openMessages.length > 1 && taskDecision.cancelScope !== "all") {
      routed.control = "none";
      routed.handled = false;
      routed.result.plan.proposals = [];
      routed.result.plan.status = "no_action";
      taskDecision = askArbitration();
    }
  }
  if (taskDecision.relation === "ask" && liveTasksOfKind(frame.openTasks, "message").length === 0) {
    taskDecision =
      messageIntent || interpretation?.kind === "message"
        ? {
            relation: "new_task",
            taskId: null,
            currentProposalId: null,
            currentItemId: null,
            kind: "message",
            unread: false,
          }
        : idleArbitration();
  }
  if (taskDecision.relation === "cancel") {
    taskDecision = { ...taskDecision, closeItemIds: messageCloseIds(frame.openTasks, taskDecision, input.conversation?.memory) };
  }
  const applyAction =
    !taskDecision.unread &&
    taskDecision.relation !== "conversation" &&
    taskDecision.relation !== "cancel" &&
    taskDecision.relation !== "ask";
  const boundTask = liveTaskById(frame.openTasks, taskDecision.taskId);
  const turnObjective = objectiveFromParts({
    outcome: interpretation?.outcome ?? "",
    question: interpretation?.question,
    elicitation: interpretation?.elicitation,
    refersTo: interpretation?.refersTo,
    facts: parentFactLines(frame.parentContext, relevantParentFacts(framed).map((fact) => fact.text)).map((text) => ({
      text,
      status: "parent_stated",
    })),
    turns: interpretation?.relevantFactIndexes,
    uncertain: interpretation?.uncertain,
    privateConstraints: interpretation?.privateConstraints,
  });
  // A new message started while another draft is live is separate work. Its question
  // is the new request. Continuity still applies when nothing else is live, including
  // a closed draft whose goal the parent has not replaced.
  const startingSeparate =
    taskDecision.relation === "new_task" && liveTasksOfKind(frame.openTasks, "message").length > 0;
  const applicable = startingSeparate
    ? null
    : objectiveForContinuity(frame.establishedObjectives, interpretation?.establishedTaskId);
  const outcomeChanged = interpretation?.outcomeChanged === true;
  const continued = continueEstablishedObjective(
    turnObjective,
    applicable
      ? {
          question: applicable.question,
          outcome: applicable.outcome,
          facts: applicable.facts,
          history: applicable.history,
          provenance: `task ${applicable.taskId} (${applicable.status})`,
        }
      : null,
    outcomeChanged
  );
  const storedObjective = mergeObjective(
    taskDecision.relation === "new_task" ? null : boundTask?.groundedIn ?? null,
    continued,
    input.message,
    boundTask?.outgoingBody ?? null,
    taskDecision.relation === "change_outcome" || outcomeChanged
  );
  const framedForDraft = {
    ...(taskDecision.relation === "new_task"
      ? { ...framed, currentDrafts: [] as string[] }
      : boundTask?.outgoingBody
        ? { ...framed, currentDrafts: [boundTask.outgoingBody] }
        : framed),
    taskObjective: storedObjective,
    revisingDraft:
      (taskDecision.relation === "revise" || taskDecision.relation === "change_outcome") &&
      !!boundTask?.outgoingBody,
  };
  const actionDecision =
    (shouldInterpret || !!pickedTask) && applyAction
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
  const liveDraft = (input.conversation?.open_proposals ?? []).some(
    (item) => item.type === "reply_coparent" && item.text.trim().length > 0
  );
  const spokenToParent =
    actionDecision?.status === "draft" && isParentFacingCopy(actionDecision.body);
  const rawDraft =
    actionDecision?.status === "draft" &&
    (requestAsDraft(actionDecision.body, input.message) ||
      spokenToParent ||
      (liveDraft && actionDecision.body.trim() === NO_DETAIL_REPLY));
  const heldReply =
    /revision did not work/i.test(routed.reply) || /couldn't draft that/i.test(routed.reply);
  const recovered =
    applyAction && rawDraft && actionDecision?.status === "draft" && !liveDraft
      ? usableOutboundBody(null, input.message, "")
      : null;
  if (applyAction && rawDraft && actionDecision?.status === "draft" && recovered) {
    Object.assign(
      routed,
      messageDraftTurn({
        message: input.message,
        recipient: actionDecision.recipient,
        body: recovered,
        outcome: actionDecision.objective?.outcome || storedObjective.outcome || actionDecision.interpretation.outcome,
        groundedIn: actionDecision.objective ?? storedObjective,
        keep: routedOtherAction ? routed.result.plan.proposals : [],
        taskId: taskDecision.relation === "new_task" ? undefined : taskDecision.taskId ?? undefined,
        unverified: true,
      })
    );
  } else if (applyAction && rawDraft && actionDecision?.status === "draft") {
    routed.reply = liveDraft
      ? "That revision did not work. The draft is unchanged."
      : spokenToParent && actionDecision?.status === "draft"
        ? actionDecision.body.trim()
        : "I couldn't draft that. What should the message say?";
    routed.handled = true;
    routed.answers = null;
    routed.result.plan.proposals = routed.result.plan.proposals.filter(
      (item) => item.type !== "reply_coparent" || !requestAsDraft(item.draft ?? "", input.message)
    );
    routed.result.plan.status = "no_action";
  } else if (
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
        outcome: actionDecision.objective?.outcome || storedObjective.outcome || actionDecision.interpretation.outcome,
        groundedIn: actionDecision.objective ?? storedObjective,
        keep: routedOtherAction ? routed.result.plan.proposals : [],
        taskId: taskDecision.relation === "new_task" ? undefined : taskDecision.taskId ?? undefined,
        answers: picked ? input.conversation?.memory?.clarification?.proposalId ?? null : null,
        unverified: actionDecision.validation === "unverified",
      })
    );
  } else if (applyAction && actionDecision?.status === "ask" && !routedMessage && !heldReply) {
    const revisingLiveDraft =
      (taskDecision.relation === "revise" || taskDecision.relation === "change_outcome") &&
      !!boundTask?.outgoingBody;
    if (actionDecision.terminalReviewFailure && !revisingLiveDraft) {
      const failedTaskId =
        applicable?.taskId ??
        (boundTask?.kind === "message" && taskDecision.relation !== "new_task" ? boundTask.id : null);
      if (failedTaskId) clearMessageObjective = { taskId: failedTaskId };
    }
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
    const options = liveTasksOfKind(frame.openTasks, "message").map((task, index) => ({
      index: index + 1,
      taskId: task.id,
      itemId: task.currentItemId,
      proposalId: task.currentProposalId,
    }));
    const question = options.length > 0 ? whichOpenMessageQuestion(frame.openTasks) : null;
    if (options.length > 0 && question) {
      Object.assign(
        routed,
        messageSelectionTurn({
          message: input.message,
          question,
          options,
        })
      );
    } else {
      routed.handled = false;
      routed.result.plan.proposals = [];
      routed.result.plan.status = "no_action";
    }
  }
  const revisingMessage =
    (taskDecision.relation === "revise" || taskDecision.relation === "change_outcome") &&
    !!boundTask?.outgoingBody;
  if (revisingMessage && boundTask?.outgoingBody) {
    const nextMessage =
      routed.result.plan.proposals.find((proposal) => proposal.type === "reply_coparent")?.draft ?? "";
    if (nextMessage.trim()) {
      const others = routed.result.plan.proposals.filter((proposal) => proposal.type !== "calendar_update");
      const inTurn = routed.result.plan.proposals.filter((proposal) => proposal.type === "calendar_update");
      const carried =
        inTurn.length > 0
          ? inTurn
          : (input.conversation?.open_proposals ?? [])
              .filter((proposal) => proposal.type === "calendar_update" && proposal.text.trim())
              .map((proposal) => ({
                type: "calendar_update" as const,
                draft: proposal.text,
                depends_on: null,
                requires_approval: true as const,
              }));
      const aligned = alignCalendarRows([...others, ...carried], boundTask.outgoingBody, nextMessage);
      routed.result.plan.proposals = aligned.proposals.filter((raw) => {
        if (!raw || typeof raw !== "object") return true;
        const row = raw as { type?: string; withheld?: boolean };
        return row.withheld !== true;
      });
      if (aligned.note && !routed.reply.includes(aligned.note)) {
        routed.reply = `${routed.reply} ${aligned.note}`.trim();
      }
    }
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
    const shown = releaseRawRequest(input, shared.reply, shared.proposals);
    routed.result.plan.proposals = shown.proposals;
    return {
      reply: shown.reply,
      actions: shown.proposals.map((p) => ({ ...p, status: "proposed" as const })),
      result: routed.result,
      control: routed.control,
      revision: routed.revision,
      answers: shown.released ? null : routed.answers ?? null,
      taskDecision,
      clearMessageObjective,
    };
  }

  if (
    taskDecision.unread ||
    taskDecision.relation === "conversation" ||
    taskDecision.relation === "cancel" ||
    taskDecision.relation === "ask"
  ) {
    const openMessageQuestion =
      taskDecision.relation === "ask" ? whichOpenMessageQuestion(frame.openTasks) : null;
    const spoken = openMessageQuestion
      ? openMessageQuestion
      : taskDecision.relation === "cancel"
        ? taskDecision.cancelScope === "all"
          ? "I canceled the open messages. Nothing was sent."
          : "I canceled that message. Nothing was sent."
        : model
          ? await model.reply(packet()).catch(() => null)
          : null;
    const observation = buildObservationFromChat(input.message, { id: input.source_id });
    return {
      reply: openMessageQuestion
        ? openMessageQuestion
        : taskDecision.relation === "cancel"
          ? spoken ?? "I canceled that message. Nothing was sent."
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
      clearMessageObjective,
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
    viewer_id: input.viewerId ?? null,
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
        clearMessageObjective,
      };
    }
  }

  const shared = await shareExpenseTurn(input.case_id, buildReply(result), result);
  const shown = releaseRawRequest(input, shared.reply, shared.proposals);
  result.plan.proposals = shown.proposals;
  const actions: ChatAction[] = shown.proposals.map((p) => ({
    ...p,
    status: "proposed" as const,
  }));

  return {
    reply: shown.reply,
    actions,
    result,
    control: "none",
    revision: null,
    taskDecision,
    clearMessageObjective,
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

function parentFactLines(context: string[] | undefined, facts: string[]): string[] {
  const seen = new Set<string>();
  const lines: string[] = [];
  for (const line of [...(context ?? []), ...facts]) {
    const text = line.trim();
    if (!text || seen.has(text)) continue;
    seen.add(text);
    lines.push(text);
  }
  return lines;
}

function messageCloseIds(
  tasks: readonly OpenTask[],
  decision: TurnArbitration,
  memory: WorkingMemory | null | undefined
): string[] {
  const options = memory?.clarification?.selectionOptions ?? [];
  const selectionId = options.length > 0 ? memory?.clarification?.itemId ?? null : null;
  const ids = new Set<string>();
  if (decision.cancelScope === "all") {
    for (const task of liveTasksOfKind(tasks, "message")) {
      if (task.currentItemId) ids.add(task.currentItemId);
    }
    if (selectionId) ids.add(selectionId);
    return [...ids];
  }
  if (decision.currentItemId) ids.add(decision.currentItemId);
  if (
    selectionId &&
    options.some((option) => option.taskId === decision.taskId || option.itemId === decision.currentItemId)
  ) {
    ids.add(selectionId);
  }
  return [...ids];
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
