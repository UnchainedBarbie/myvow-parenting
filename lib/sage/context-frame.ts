/**
 * ContextFrame is the server-side picture of one parent's current Sage turn.
 *
 * It is the input to conversation-to-action interpretation. Parent statements, Sage's own
 * earlier wording, and anything attributed to the co-parent stay in separate facts so a draft
 * cannot treat Sage's summary, or an allegation, as a verified event.
 *
 * This object is ready for authorized historical retrieval (other sessions, messages, calendar
 * records, documents, expenses, decisions). Stage 1 fills only the current session. Retrieved
 * history, when added later, is context: it does not become the live task, and it is never the
 * other parent's private Sage conversation.
 */

import type { KnownCoparent } from "@/lib/sage/chat-intent";
import type { KnownChild } from "@/lib/sage/calendar-chat";
import type { ConversationContext } from "@/lib/sage/conversation-context";
import type { ConversationTurn } from "@/lib/sage/conversation-reply";
import { proposalId } from "@/lib/sage/proposal-lifecycle";
import { openTasksFromMemory, type OpenTask } from "@/lib/sage/open-task";
import { focusKindOf } from "@/lib/sage/working-memory";

export type Speaker = "parent" | "sage" | "coparent";

export type FactOrigin = "session" | "history";

export type ConversationalFact = {
  text: string;
  speaker: Speaker;
  origin: FactOrigin;
};

export type ActionKind = "message" | "calendar" | "expense" | "document" | "conversation" | "unknown";

export type ActionGrounding = "conversation" | "calendar_event" | "insufficient";

export type ActionInterpretation = {
  kind: ActionKind;
  /** What the parent wants to happen as a result of this turn. */
  outcome: string;
  /** The earlier discussion this request continues, or null when it stands alone. */
  refersTo: string | null;
  grounding: ActionGrounding;
  relevantFactIndexes: number[];
  uncertain: string[];
  /** Claims the parent reported that are not independently verified in this frame. */
  disputed: string[];
  recipientName: string | null;
  /**
   * How the parent wants the co-parent to answer.
   *   open_question            Invite them to state a position.
   *   predetermined_admission  The parent wants a specific conclusion confirmed. A draft must not
   *                            write that trap; it asks about the factual topic instead.
   */
  elicitation?: "open_question" | "predetermined_admission" | null;
};

export type OpenWork = {
  kind: string;
  text: string;
  proposalId: string | null;
};

export type CompletedWork = {
  kind: string;
  title: string | null;
};

/**
 * Kinds of work this chat interface can propose. Historical retrieval will read the same list
 * when deciding what earlier records are in reach; it does not activate those records as tasks.
 */
export const SESSION_CAPABILITIES: readonly ActionKind[] = [
  "calendar",
  "expense",
  "document",
  "message",
  "conversation",
];

export type ContextFrame = {
  parentId: string;
  caseId: string;
  role: string | null;
  sessionId: string | null;
  children: { id: string; name: string }[];
  coparents: { name: string; email: string | null }[];
  recentTurns: ConversationTurn[];
  facts: ConversationalFact[];
  requestText: string;
  interpretation: ActionInterpretation | null;
  openProposals: OpenWork[];
  openClarification: OpenWork | null;
  completed: CompletedWork[];
  /** Live and closed tasks derived from this session's proposals. Historical sessions are not mixed in. */
  openTasks: OpenTask[];
  /**
   * Outgoing drafts this turn may revise. Undefined keeps every open message proposal.
   * Empty means this turn starts a new message and must not rewrite another draft.
   */
  currentDrafts?: string[];
  capabilities: readonly ActionKind[];
};

export type BuildContextFrameInput = {
  parentId: string;
  caseId: string;
  role?: string | null;
  sessionId?: string | null;
  message: string;
  recentTurns?: ConversationTurn[];
  conversation?: ConversationContext | null;
  children?: KnownChild[];
  coparents?: KnownCoparent[];
};

function firstName(name: string): string {
  return name.trim().split(/\s+/)[0] ?? "";
}

function scrub(text: string, max = 800): string {
  return text.replace(/\s+/g, " ").trim().slice(0, max);
}

/** True when this session already holds a scheduled event, not merely a medical noun in the chat. */
export function hasEstablishedSchedule(conversation: ConversationContext | null | undefined): boolean {
  if (!conversation) return false;
  const event = conversation.event;
  if (event?.date || event?.time || event?.eventId) return true;
  return (conversation.open_proposals ?? []).some((proposal) => proposal.type === "calendar_update");
}

function factsFromTurns(turns: ConversationTurn[]): ConversationalFact[] {
  const facts: ConversationalFact[] = [];
  for (const turn of turns) {
    const text = scrub(turn.text);
    if (!text) continue;
    const speaker: Speaker = turn.role === "sage" ? "sage" : "parent";
    facts.push({ text, speaker, origin: "session" });
  }
  return facts;
}

function openWork(conversation: ConversationContext | null | undefined): {
  proposals: OpenWork[];
  clarification: OpenWork | null;
} {
  const memory = conversation?.memory ?? null;
  const clarification = memory?.clarification
    ? {
        kind: memory.clarification.kind,
        text: memory.clarification.question,
        proposalId: memory.clarification.proposalId,
      }
    : null;
  const proposals: OpenWork[] = [];
  for (const card of conversation?.open_proposals ?? []) {
    if (card.type === "ask_clarification" || card.type === "note_only") continue;
    proposals.push({
      kind: focusKindOf({ type: card.type }, null),
      text: scrub(card.text ?? "", 240),
      proposalId: proposalId(card),
    });
  }
  return { proposals, clarification };
}

function completedWork(conversation: ConversationContext | null | undefined): CompletedWork[] {
  const history = conversation?.memory?.history ?? [];
  const done: CompletedWork[] = [];
  for (const entry of history) {
    if (entry.status !== "executed") continue;
    const title = entry.fields.title;
    done.push({
      kind: entry.kind,
      title: typeof title === "string" ? scrub(title, 80) : null,
    });
    if (done.length >= 6) break;
  }
  return done;
}

/** Assemble the frame from what this parent is already allowed to see in this session. */
export function buildContextFrame(input: BuildContextFrameInput): ContextFrame {
  const recentTurns = (input.recentTurns ?? []).filter((turn) => turn.text.trim());
  const { proposals, clarification } = openWork(input.conversation);
  return {
    parentId: input.parentId,
    caseId: input.caseId,
    role: input.role ?? null,
    sessionId: input.sessionId ?? null,
    children: (input.children ?? []).map((child) => ({
      id: child.id,
      name: firstName(child.name) || child.name,
    })),
    coparents: (input.coparents ?? []).map((coparent) => ({
      name: coparent.name,
      email: coparent.email,
    })),
    recentTurns,
    facts: factsFromTurns(recentTurns),
    requestText: input.message.trim(),
    interpretation: null,
    openProposals: proposals,
    openClarification: clarification,
    completed: completedWork(input.conversation),
    openTasks: openTasksFromMemory(input.conversation?.memory, {
      ownerId: input.parentId,
      caseId: input.caseId,
      sessionId: input.sessionId ?? null,
    }),
    capabilities: SESSION_CAPABILITIES,
  };
}

export function withInterpretation(frame: ContextFrame, interpretation: ActionInterpretation | null): ContextFrame {
  return { ...frame, interpretation };
}

/** Parent-stated lines the interpreter marked as relevant, or every parent line when none were marked. */
export function relevantParentFacts(frame: ContextFrame): ConversationalFact[] {
  const parentFacts = frame.facts.filter((fact) => fact.speaker === "parent");
  const indexes = frame.interpretation?.relevantFactIndexes ?? [];
  if (indexes.length === 0) return parentFacts;
  const picked = indexes
    .map((index) => frame.facts[index])
    .filter((fact): fact is ConversationalFact => !!fact && fact.speaker === "parent");
  return picked.length > 0 ? picked : parentFacts;
}

export function sageOnlyFacts(frame: ContextFrame): ConversationalFact[] {
  return frame.facts.filter((fact) => fact.speaker === "sage");
}

export function coparentFacts(frame: ContextFrame): ConversationalFact[] {
  return frame.facts.filter((fact) => fact.speaker === "coparent");
}

/** True when an earlier parent turn in this session carries substance a later action can refer to. */
export function hasConversationSubstance(frame: ContextFrame): boolean {
  return frame.facts.some((fact) => fact.speaker === "parent" && fact.text.trim().length > 12);
}

/**
 * True when this frame already holds a discussion a message can continue.
 * A later request may point at that discussion with "him", "that", or "what we discussed"
 * without restating it. Clarification is for when this is false.
 */
export function conversationSupportsDraft(frame: ContextFrame): boolean {
  return relevantParentFacts(frame).some((fact) => fact.text.trim().length > 12);
}
