/**
 * Deterministic routing for a Sage chat turn.
 * Uses the message, the open conversation, and the known co-parent.
 * Proposes only. Nothing here sends, files, or writes.
 */

import { bareCorrection, type ConversationContext } from "@/lib/sage/conversation-context";
import { hasMessageSubstance } from "@/lib/messages/message-content";
import type { Observation } from "@/lib/sage/observation-builder";
import type { Plan, Proposal } from "@/lib/sage/planner";
import { isInactiveProposal, reviseProposal } from "@/lib/sage/proposal-lifecycle";
import type { ProcessObservationResult } from "@/lib/sage/process-observation";
import {
  answerCalendarQuestion,
  appointmentSubject,
  clockWithMeridiem,
  composeEventDescription,
  earlyArrivalNote,
  followUpTargets,
  isCalendarQuestion,
  isCancelRequest,
  isEventDetailUpdate,
  locationPhrase,
  matchChildren,
  wantsAllDay,
  type CaseEvent,
  type KnownChild,
} from "@/lib/sage/calendar-chat";
import { appointmentTitle, calendarCategory } from "@/lib/sage/calendar-labels";
import { inferExpenseCategoryFromText, parseExpenseAmountFromText } from "@/lib/expenses-share";
import { detectExpenseLoggingIntent, detectExpensePayer } from "@/lib/expenses-sharing";
import {
  filedDocumentState,
  interpretDocumentTurn,
  isDocumentEdit,
  isDocumentFilingRequest,
  openDocumentStates,
  revisionFromProposal,
  type DocumentProposalState,
} from "@/lib/sage/document-intent";
import {
  answerDocumentQuestion,
  isDocumentQuestion,
  pickSavedForEdit,
  type SearchableDocument,
} from "@/lib/sage/document-search";
import { finalizeExpenseProposals } from "@/lib/sage/expense-date";
import { formatClockLabel, preferEventSubject } from "@/lib/sage/event-subject";
import { resolveDate } from "@/lib/sage/resolver";
import type { SageInterpretation } from "@/lib/sage/understanding";
import {
  interruptsClarification,
  isExplicitNoteRequest,
  type CollectedFields,
  type FocusKind,
  type WorkingMemory,
} from "@/lib/sage/working-memory";
import { requestsDocumentAnalysis } from "@/lib/sage/document-read";

export type KnownCoparent = {
  name: string;
  email: string | null;
};

export type ChatControl = "none" | "cancel_message" | "revise_pending" | "revise_document";

export type PendingRevision = {
  date: string;
  label: string;
  time: string | null;
  document?: {
    key: string;
    title: string;
    description: string;
    category: string;
    visibility: "private" | "parents_only" | "family";
    childId: string | null;
    childName: string | null;
    fileName: string | null;
    documentId: string | null;
    updatesExisting: boolean;
  } | null;
};

export type RoutedTurn = {
  handled: boolean;
  control: ChatControl;
  reply: string;
  revision: PendingRevision | null;
  /** The open question this turn answered, by proposal id. Absent when the turn answers none. */
  answers?: string | null;
  result: ProcessObservationResult;
};

export type RouteChatIntentInput = {
  message: string;
  conversation?: ConversationContext | null;
  coparents?: KnownCoparent[];
  children?: KnownChild[];
  /** Saved events the signed-in parent is allowed to see. */
  events?: CaseEvent[];
  viewerId?: string;
  viewerRole?: string | null;
  /** Saved documents this viewer is allowed to see. */
  documents?: SearchableDocument[];
  /** A forwarded email is private intake until the user asks for an action. */
  intake?: "chat" | "self_forward";
  timezone?: string;
  today?: Date;
  attachmentNames?: string[];
  /**
   * How the caller read this turn against an open question.
   * "conversation" keeps free text from becoming the answer to that question.
   * Omitted keeps the existing slot filling.
   */
  taskTurn?: "conversation";
};

const WEEKDAY =
  "monday|tuesday|wednesday|thursday|friday|saturday|sunday|tomorrow|today|tonight";

function proposal(
  type: Proposal["type"],
  draft: string,
  extra: Partial<Proposal> = {}
): Proposal {
  return {
    type,
    draft,
    depends_on: null,
    requires_approval: true,
    ...extra,
  };
}

function prettyDate(iso: string): string {
  const match = iso.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return iso;
  const dt = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]), 12));
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "UTC",
    weekday: "short",
    month: "short",
    day: "numeric",
  }).format(dt);
}

function clockFromText(text: string): { label: string; eventStart: string | null } | null {
  const spoken = text.match(/\b(\d{1,2})(?::(\d{2}))?\s*(a\.?m\.?|p\.?m\.?)\b/i);
  if (spoken) {
    let hour = Number(spoken[1]);
    const minute = spoken[2] != null ? Number(spoken[2]) : 0;
    const meridiem = spoken[3].toLowerCase();
    if (hour < 1 || hour > 12 || minute > 59) return null;
    if (meridiem.startsWith("p") && hour < 12) hour += 12;
    if (meridiem.startsWith("a") && hour === 12) hour = 0;
    const hhmm = `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
    return { label: formatClockLabel(hhmm), eventStart: hhmm };
  }
  const hm = text.match(/\b(\d{1,2}):(\d{2})\b/);
  if (hm) return { label: `${hm[1]}:${hm[2]}`, eventStart: null };
  const bare = text.match(/\bat\s+(\d{1,2})\b/i);
  if (bare) return { label: bare[1], eventStart: null };
  return null;
}

function article(subject: string): string {
  return /^[aeiou]/i.test(subject) ? "an" : "a";
}

function eventSubject(text: string, conversation: ConversationContext | null): string | null {
  return preferEventSubject(
    appointmentSubject(text)?.subject ?? null,
    conversation?.event.subject ?? null
  );
}

const NOT_A_CHILD = new Set([
  "i",
  "sage",
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
  "sunday",
  "tomorrow",
  "today",
  "tonight",
  "please",
  "can",
  "could",
  "would",
  "add",
  "let",
  "tell",
  "send",
  "the",
  "and",
  "school",
  "appointment",
]);

function childName(text: string, coparents: KnownCoparent[]): string | null {
  const blocked = new Set(
    coparents.flatMap((c) => c.name.toLowerCase().split(/\s+/).filter(Boolean))
  );
  const possessive = text.match(/\b([A-Za-z][a-z]{1,20})'s\b/);
  if (possessive) {
    const name = possessive[1];
    const key = name.toLowerCase();
    if (!NOT_A_CHILD.has(key) && !blocked.has(key)) {
      return name.charAt(0).toUpperCase() + name.slice(1);
    }
  }
  for (const match of text.matchAll(/\b([A-Z][a-z]{1,20})\b/g)) {
    const name = match[1];
    const key = name.toLowerCase();
    if (NOT_A_CHILD.has(key) || blocked.has(key)) continue;
    return name;
  }
  return null;
}

function firstName(name: string): string {
  return name.trim().split(/\s+/)[0]?.toLowerCase() ?? "";
}

function matchCoparent(token: string, coparents: KnownCoparent[]): KnownCoparent[] {
  const needle = token.toLowerCase();
  return coparents.filter((c) => {
    const full = c.name.trim().toLowerCase();
    return full === needle || firstName(c.name) === needle;
  });
}

type Notify =
  | { kind: "none" }
  | { kind: "one"; coparent: KnownCoparent }
  | { kind: "clarify"; reply: string };

const ROLE_TOKEN = new Set([
  "co",
  "coparent",
  "coparents",
  "parent",
  "parents",
  "other",
  "the",
  "my",
  "a",
  "an",
]);

/** Relationship words. These are never looked up as a person's name. */
export function refersToCoparentRole(text: string): boolean {
  return /\bco[-\s]?parents?\b/i.test(text) || /\b(?:the\s+)?other\s+parent\b/i.test(text);
}

/** True when the parent is asking Sage to prepare or send a message to the co-parent. */
export function isMessageDraftRequest(text: string): boolean {
  return wantsNotify(text);
}

function wantsNotify(text: string): boolean {
  const lower = text.toLowerCase();
  if (/\b(let|tell) me\b/.test(lower) && !/\b(him|her|them)\b/.test(lower) && !refersToCoparentRole(text)) {
    return false;
  }
  if (refersToCoparentRole(text) && /\b(let|tell|notify|message|email|text|remind|know)\b/.test(lower)) {
    return true;
  }
  if (/\b(let|tell|notify|message|email|text|remind)\b/.test(lower) && /\b(know|him|her|them)\b/.test(lower)) {
    return true;
  }
  if (/\bneeds to know\b/.test(lower)) return true;
  if (/\b(send|draft) (a |the )?(message|text|email|note)\b/.test(lower)) return true;
  if (/\b(let|tell|notify|message|email)\s+[a-z]{2,20}\b/.test(lower)) return true;
  return false;
}

function soleRecipient(coparents: KnownCoparent[]): Notify {
  if (coparents.length === 1) return { kind: "one", coparent: coparents[0] };
  if (coparents.length === 0) {
    return {
      kind: "clarify",
      reply: "I don't have a co-parent on this case to send that to.",
    };
  }
  return {
    kind: "clarify",
    reply: "Who should I send that to? I won't guess between co-parents.",
  };
}

function resolveNotify(
  text: string,
  coparents: KnownCoparent[],
  conversation: ConversationContext | null
): Notify {
  if (!wantsNotify(text)) return { kind: "none" };
  const lower = text.toLowerCase();
  if (refersToCoparentRole(text) || /\b(him|her|them)\b/.test(lower)) {
    return soleRecipient(coparents);
  }
  const named: KnownCoparent[] = [];
  for (const coparent of coparents) {
    const token = firstName(coparent.name);
    if (token.length > 1 && new RegExp(`\\b${token}\\b`, "i").test(text)) {
      named.push(coparent);
    }
  }
  const uniqueNamed = [...new Map(named.map((c) => [c.name.toLowerCase(), c])).values()];
  if (uniqueNamed.length > 1) {
    return {
      kind: "clarify",
      reply: "More than one person matches that name. Who should I address?",
    };
  }
  if (uniqueNamed.length === 1) return { kind: "one", coparent: uniqueNamed[0] };

  const directed = lower.match(/\b(?:let|tell|notify|message|email)\s+([a-z]{2,20})\b/);
  if (
    directed &&
    !["him", "her", "them", "know", "me", "you"].includes(directed[1]) &&
    !ROLE_TOKEN.has(directed[1])
  ) {
    const hits = matchCoparent(directed[1], coparents);
    if (hits.length === 1) return { kind: "one", coparent: hits[0] };
    return {
      kind: "clarify",
      reply: `I don't have ${directed[1]} as a co-parent on this case, so I won't guess a recipient.`,
    };
  }

  if (coparents.length === 1 && conversation?.event.subject) {
    return { kind: "one", coparent: coparents[0] };
  }
  return {
    kind: "clarify",
    reply: "Who should receive that message?",
  };
}

function explicitSchedule(text: string): boolean {
  return /\b(add|put|schedule|book|calendar)\b/i.test(text);
}

/** A completed payment. An appointment noun in the same sentence does not schedule it. */
function isPaymentReport(text: string): boolean {
  if (parseExpenseAmountFromText(text) == null) return false;
  return /\b(paid|pay|spent|spend|spending|payment|bought|buy|cost|bill|charge|receipt)\b/i.test(text);
}

function wantsCalendar(text: string): boolean {
  if (isDocumentFilingRequest(text)) return false;
  if (isPaymentReport(text) && !explicitSchedule(text)) return false;
  const lower = text.toLowerCase();
  const hasWhen =
    new RegExp(`\\b(${WEEKDAY})\\b`).test(lower) ||
    clockFromText(text) != null;
  const hasEvent =
    /\b(school|appointment|practice|pickup|pick-up|pick up|drop-?off|drop off|recital|game|therapy|dentist|doctor|ot|class|event|calendar)\b/.test(
      lower
    );
  const asksAdd = explicitSchedule(text);
  return (hasWhen && hasEvent) || (asksAdd && (hasEvent || hasWhen));
}

export function pendingDocument(conversation: ConversationContext | null): DocumentProposalState | null {
  return openDocumentStates(conversation?.open_proposals)[0] ?? null;
}

function wantsDocument(text: string): boolean {
  return /\b(save|file|store)\b[^.?]{0,40}\b(document|documents)\b/i.test(text) ||
    /\bfile (this|that|it)\b/i.test(text);
}

function wantsExpense(text: string): boolean {
  if (isPaymentReport(text)) return true;
  return /\blog (this |that |the )?(expense|receipt)\b/i.test(text) ||
    /\b(add|enter|record) (this |that |an |the )?expense\b/i.test(text);
}

/**
 * A self-contained request that can stand apart from an open question.
 * A short follow-up such as "let him know" is not a new request.
 */
export function explicitRequestKind(message: string): FocusKind | null {
  if (isExplicitNoteRequest(message)) return null;
  if (isPaymentReport(message) || wantsExpense(message)) return "expense";
  if (
    isDocumentFilingRequest(message) ||
    wantsDocument(message) ||
    isDocumentQuestion(message) ||
    requestsDocumentAnalysis(message, false)
  ) {
    return "document";
  }
  if (wantsCalendar(message)) return "calendar";
  return null;
}

/**
 * Leave an open clarification in place when this turn is a note, a retrieval
 * or unrecognized reply, or an explicit request of a different kind.
 */
export function shouldPreserveOpenWork(
  message: string,
  memory: WorkingMemory | null | undefined,
  proposals: { type?: string }[]
): boolean {
  if (isExplicitNoteRequest(message)) return true;
  if (proposals.length === 0) return true;
  return interruptsClarification(explicitRequestKind(message), memory);
}

function expenseDescription(text: string): string {
  const cleaned = text
    .replace(/\$\s*\d[\d,]*(?:\.\d{1,2})?/g, " ")
    .replace(/\b(today|tomorrow|tonight|monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/gi, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/[.?!]+$/g, "");
  return cleaned.slice(0, 120);
}

function isAdvice(text: string): "wording" | "unpaid" | null {
  const lower = text.toLowerCase();
  if (/\bwhat should i say\b/.test(lower) || /\bhow should i (say|word|phrase|tell)\b/.test(lower)) {
    return "wording";
  }
  if (/\b(hasn't|has not|haven't|have not) paid\b/.test(lower) || /\bstill hasn't\b/.test(lower)) {
    return "unpaid";
  }
  return null;
}

function isCancel(text: string): boolean {
  const lower = text.toLowerCase();
  return (
    /\b(don't|do not|dont) send\b/.test(lower) ||
    /\bcancel (that|the|this) (message|text|email)\b/.test(lower) ||
    /\bnever mind\b/.test(lower) && /\b(message|send|that)\b/.test(lower)
  );
}

function datePhrase(text: string): string | null {
  const match = text.match(
    /\b(tomorrow|today|tonight|monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/i
  );
  return match ? match[1] : null;
}

function resolvedDay(text: string, today: Date, timezone: string): { iso: string; label: string } | null {
  const phrase = datePhrase(text);
  if (!phrase) return null;
  const resolved = resolveDate(phrase, today, timezone, text);
  if (resolved.status !== "resolved" || !resolved.iso) return null;
  return { iso: resolved.iso, label: prettyDate(resolved.iso) };
}

function isDateCorrection(text: string, conversation: ConversationContext | null): boolean {
  const lower = text.toLowerCase();
  if (/\b(add|let|tell|send|notify)\b/.test(lower)) return false;
  const openCalendar = (conversation?.open_proposals ?? []).some((p) => p.type === "calendar_update");
  const established = Boolean(conversation?.event.date || conversation?.event.subject);
  if (!openCalendar && !established) return false;
  const correction = /\b(make that|change (that|it)|move (that|it)|actually)\b/.test(lower);
  const when = new RegExp(`\\b(${WEEKDAY})\\b`).test(lower) || clockFromText(text) != null;
  return correction && when;
}

function transitionEvent(text: string): boolean {
  return /\b(school|pickup|pick-up|pick up|drop-?off|drop off|exchange)\b/i.test(text);
}

/** Calendar-notification wording. Used only when an event is already established or this turn schedules one. */
export function calendarNotifyBody(facts: {
  child: string | null;
  subject: string | null;
  dateLabel: string | null;
  timeLabel: string | null;
}): string | null {
  return messageBody(facts);
}

function messageBody(facts: {
  child: string | null;
  subject: string | null;
  dateLabel: string | null;
  timeLabel: string | null;
}): string | null {
  const subject = facts.subject;
  const who = facts.child;
  if (!subject && !who && !facts.dateLabel && !facts.timeLabel) return null;
  const head =
    subject === "school" && who
      ? `${who} needs to be at school`
      : subject === "pickup" && who
        ? `${who} has a pickup`
        : subject === "drop-off" && who
          ? `${who} has a drop-off`
          : subject
            ? who
              ? `${who} has ${article(subject)} ${subject}`
              : subject
            : who
              ? `${who} has an update`
              : "There is an update";
  const when = [facts.dateLabel ? `on ${facts.dateLabel}` : null, facts.timeLabel ? `at ${facts.timeLabel}` : null]
    .filter(Boolean)
    .join(" ");
  return `${head}${when ? ` ${when}` : ""}.`;
}

function shell(opts: {
  message: string;
  summary: string;
  itemType: string;
  plan: Plan;
  child: string | null;
  dateIso: string | null;
  eventSubject: string | null;
  childIds?: string[];
  amount?: number | null;
  expenseCategory?: string | null;
}): ProcessObservationResult {
  const interpretation: SageInterpretation = {
    intent: {
      item_type: opts.itemType,
      domain: "coordination",
      summary: opts.summary,
      evidence_excerpt: opts.message.split(/\s+/).slice(0, 10).join(" "),
      tool_name: opts.plan.proposals.some((p) => p.type === "reply_coparent") ? "messaging" : null,
      action_required: opts.plan.status === "ready",
      action_type: opts.plan.status === "ready" ? "propose" : null,
      urgency: "normal",
      confidence: 0.9,
    },
    entities: {
      children: opts.child ? [{ name: opts.child, confidence: 0.8 }] : [],
      people: [],
      dates: opts.dateIso ? [{ value: opts.dateIso, raw: opts.dateIso }] : [],
      amounts:
        opts.amount != null && opts.amount > 0
          ? [{ value: opts.amount, currency: "USD" }]
          : [],
      merchants: [],
      providers: [],
      documents: [],
    },
    reasoning: { signals: ["chat-intent"] },
  };
  const observation: Observation = {
    target_id: "chat",
    root_id: null,
    messages: [],
    thread_length: 1,
    has_context: true,
    source: "chat",
  };
  return {
    observation,
    interpretation,
    child_ids: opts.childIds ?? [],
    unresolved_children: opts.childIds?.length ? [] : opts.child ? [opts.child] : [],
    resolved_dates: opts.dateIso
      ? [{ raw: opts.dateIso, status: "resolved", iso: opts.dateIso, reason: "chat-intent" }]
      : [],
    plan: opts.plan,
    event_subject: opts.eventSubject ?? undefined,
    ...(opts.expenseCategory ? { expense_category: opts.expenseCategory } : {}),
  };
}

function turn(opts: {
  handled: boolean;
  control?: ChatControl;
  reply: string;
  revision?: PendingRevision | null;
  message: string;
  summary: string;
  itemType: string;
  proposals: Proposal[];
  status?: Plan["status"];
  child?: string | null;
  dateIso?: string | null;
  eventSubject?: string | null;
  childIds?: string[];
  amount?: number | null;
  expenseCategory?: string | null;
  reasoning: string;
  /** Id of the open question this turn answers. The route closes that question by id. */
  answers?: string | null;
}): RoutedTurn {
  const plan: Plan = {
    status: opts.status ?? (opts.proposals.some((p) => p.type !== "note_only") ? "ready" : "no_action"),
    proposals: opts.proposals,
    reasoning: opts.reasoning,
  };
  return {
    handled: opts.handled,
    control: opts.control ?? "none",
    reply: opts.reply,
    revision: opts.revision ?? null,
    ...(opts.answers ? { answers: opts.answers } : {}),
    result: shell({
      message: opts.message,
      summary: opts.summary,
      itemType: opts.itemType,
      plan,
      child: opts.child ?? null,
      dateIso: opts.dateIso ?? null,
      eventSubject: opts.eventSubject ?? null,
      childIds: opts.childIds,
      amount: opts.amount,
      expenseCategory: opts.expenseCategory,
    }),
  };
}

/** A message drafted from the conversation. It still needs review; nothing is sent. */
export function messageDraftTurn(opts: {
  message: string;
  recipient: KnownCoparent;
  body: string;
  outcome: string;
  keep?: Proposal[];
  taskId?: string;
  groundedIn?: Proposal["grounded_in"];
  /** Closes a pending selection question by id. */
  answers?: string | null;
}): RoutedTurn {
  const privateObjective = opts.groundedIn?.outcome?.trim() || opts.outcome;
  const messageCard = proposal("reply_coparent", opts.body, {
    recipient_name: opts.recipient.name,
    recipient_email: opts.recipient.email ?? "",
    draft_origin: "sage_wording",
    ...(privateObjective ? { private_objective: privateObjective } : {}),
    ...(opts.groundedIn ? { grounded_in: opts.groundedIn } : {}),
    ...(opts.taskId ? { task_id: opts.taskId } : {}),
  });
  const kept = (opts.keep ?? []).filter((item) => item.type !== "reply_coparent" && item.type !== "note_only");
  const proposals = [...kept, messageCard];
  const hasCalendar = proposals.some((item) => item.type === "calendar_update");
  const reply = hasCalendar
    ? `I prepared a calendar event and a separate message to ${opts.recipient.name}. Each one needs your approval.`
    : `Here is a message to ${opts.recipient.name}. Nothing is sent until you review it and choose Send.`;
  return turn({
    handled: true,
    reply,
    message: opts.message,
    summary: opts.outcome || reply,
    itemType: hasCalendar ? "calendar_event" : "message",
    proposals,
    reasoning:
      "The parent asked for a message that continues this conversation. The draft uses that conversation and still needs approval.",
    ...(opts.answers ? { answers: opts.answers } : {}),
  });
}

/** Sage asked which live message the parent means. The options are stored so a short answer can resolve them. */
export function messageSelectionTurn(opts: {
  message: string;
  question: string;
  options: NonNullable<Proposal["selection_options"]>;
}): RoutedTurn {
  const ask = proposal("ask_clarification", opts.question, {
    audience: "parent",
    selection_options: opts.options,
  });
  return turn({
    handled: true,
    reply: opts.question,
    message: opts.message,
    summary: opts.question,
    itemType: "note",
    proposals: [ask],
    status: "awaiting_clarification",
    reasoning: "More than one message could fit, so Sage asked which one and stored the choices.",
  });
}

/** Sage cannot determine the intended message from the conversation, so it asks rather than inventing. */
export function messageAskTurn(opts: {
  message: string;
  question: string;
  recipient?: KnownCoparent | null;
  keep?: Proposal[];
}): RoutedTurn {
  const kept = (opts.keep ?? []).filter((item) => item.type !== "reply_coparent" && item.type !== "note_only");
  const ask = proposal("ask_clarification", opts.question, {
    audience: "parent",
    clarifies: "message",
    ...(opts.recipient?.name ? { recipient_name: opts.recipient.name } : {}),
    ...(opts.recipient?.email ? { recipient_email: opts.recipient.email } : {}),
  });
  return turn({
    handled: true,
    reply: opts.question,
    message: opts.message,
    summary: opts.question,
    itemType: kept.some((item) => item.type === "calendar_update") ? "calendar_event" : "message",
    proposals: [...kept, ask],
    status: "awaiting_clarification",
    reasoning: "The intended message could not be determined from the conversation, so Sage asked rather than inventing one.",
  });
}

export function selfForwardResult(message: string, attachmentNames: string[] = []): RoutedTurn {
  const files = attachmentNames.filter((name) => name.trim());
  const fileNote = files.length > 0 ? ` Attachments saved privately: ${files.join(", ")}.` : "";
  const reply =
    "I saved that email privately." +
    fileNote +
    " Nothing has been filed, added to the calendar, logged, or sent. Tell me if you want a calendar event, a document, an expense, or a message drafted.";
  return turn({
    handled: true,
    reply,
    message,
    summary: "Private email saved for you to review.",
    itemType: "note",
    proposals: [proposal("note_only", "Private email. No action until you ask.")],
    reasoning: "Self-forward stays in private intake until the user asks for an action.",
  });
}

function openMessage(conversation: ConversationContext | null): boolean {
  return (conversation?.open_proposals ?? []).some((p) => p.type === "reply_coparent");
}

function expenseAnswer(
  message: string,
  description: string,
  amount: number,
  category: string | null,
  fields: CollectedFields,
  answers: string | null = null
): RoutedTurn {
  const sharing = fieldText(fields, "sharing_intent");
  const payer = fieldText(fields, "payer_name");
  return turn({
    handled: true,
    answers,
    reply: "I can log that expense once you approve it.",
    message,
    summary: description,
    itemType: "expense",
    amount,
    expenseCategory: category,
    proposals: [
      proposal("log_expense", description, {
        description,
        amount,
        ...(category ? { category } : {}),
        paid_by: fields.paid_by === "coparent" ? "coparent" : "self",
        ...(payer ? { payer_name: payer } : {}),
        ...(sharing === "personal" || sharing === "shared" || sharing === "unspecified"
          ? { sharing_intent: sharing }
          : {}),
        ...(typeof fields.stated_percent === "number" ? { stated_percent: fields.stated_percent } : {}),
      }),
    ],
    reasoning: "The parent supplied the missing expense detail. The expense still needs approval.",
  });
}

function fieldText(fields: CollectedFields, key: string): string | null {
  const value = fields[key];
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

/**
 * Free text that would be taken as the body of the message an open question asks for.
 * Null when no message question is open or the turn is a request of another kind.
 */
export function messageAnswerCandidate(
  message: string,
  memory: WorkingMemory | null | undefined
): { name: string; email: string; body: string } | null {
  const clarification = memory?.clarification;
  if (!clarification || clarification.kind !== "message" || isExplicitNoteRequest(message)) return null;
  if ((clarification.selectionOptions?.length ?? 0) > 0) return null;
  if (
    wantsExpense(message) ||
    wantsCalendar(message) ||
    isDocumentQuestion(message) ||
    isDocumentFilingRequest(message) ||
    requestsDocumentAnalysis(message, false) ||
    explicitSchedule(message)
  ) {
    return null;
  }
  const name = fieldText(clarification.collected, "recipient_name");
  const email = fieldText(clarification.collected, "recipient_email");
  const body = message.trim();
  if (!name || !email || body.length < 2) return null;
  return { name, email, body };
}

/** A short answer to an open question becomes one proposal. A new request does not. */
function completeOpenDetail(
  message: string,
  memory: WorkingMemory | null | undefined,
  taskTurn?: "conversation"
): RoutedTurn | null {
  const clarification = memory?.clarification;
  if (!clarification || isExplicitNoteRequest(message)) return null;
  const fields = clarification.collected;
  if (clarification.kind === "expense") {
    if (wantsCalendar(message) || isDocumentQuestion(message) || isDocumentFilingRequest(message)) return null;
    const storedAmount = typeof fields.amount === "number" ? fields.amount : null;
    const needsAmount = clarification.missing.includes("amount") || storedAmount == null;
    if (!needsAmount && clarification.missing.includes("category") && !fieldText(fields, "category")) {
      const category = inferExpenseCategoryFromText(message);
      const description = fieldText(fields, "description") ?? fieldText(fields, "title") ?? "Expense";
      if (!category || storedAmount == null || message.trim().split(/\s+/).length > 3) return null;
      return expenseAnswer(message, description, storedAmount, category, fields, clarification.proposalId);
    }
    if (!needsAmount) return null;
    const amount = parseExpenseAmountFromText(message);
    if (amount == null || bareCorrection(message)?.kind !== "amount") return null;
    const description = fieldText(fields, "description") ?? fieldText(fields, "title") ?? "Expense";
    const category = fieldText(fields, "category") ?? inferExpenseCategoryFromText(description);
    return expenseAnswer(message, description, amount, category, fields, clarification.proposalId);
  }
  if (clarification.kind === "message") {
    // The caller read this turn as conversation. The question stays open.
    if (taskTurn === "conversation") return null;
    const candidate = messageAnswerCandidate(message, memory);
    if (!candidate) return null;
    const { name, email, body } = candidate;
    // Text with nothing to say is not a message. The question stays open and the parent is asked again.
    if (!hasMessageSubstance(body)) {
      return turn({
        handled: true,
        reply: `That doesn't give me a message for ${name} yet, so I haven't drafted anything. What do you want ${name} to know or do?`,
        message,
        summary: `No message content for ${name}`,
        itemType: "note",
        proposals: [],
        status: "no_action",
        reasoning:
          "The parent's text had no content for a message. The open question stays open and nothing was drafted.",
      });
    }
    // The parent's words are kept exactly as typed and are labeled as theirs.
    return turn({
      handled: true,
      answers: clarification.proposalId,
      reply: `Here is your message to ${name}, in your own words. Nothing is sent until you review it and choose Send.`,
      message,
      summary: `Message to ${name}`,
      itemType: "message",
      proposals: [
        proposal("reply_coparent", body, {
          recipient_name: name,
          recipient_email: email,
          draft_origin: "parent_text",
        }),
      ],
      reasoning: "The parent supplied the message. It still needs review and approval before anything is sent.",
    });
  }
  return null;
}

export function routeChatIntent(input: RouteChatIntentInput): RoutedTurn {
  const message = input.message ?? "";
  const conversation = input.conversation ?? null;
  const coparents = input.coparents ?? [];
  const children = input.children ?? [];
  const events = input.events ?? [];
  const timezone = input.timezone ?? "America/Denver";
  const today = input.today ?? new Date();
  const interrupt = interruptsClarification(explicitRequestKind(message), conversation?.memory);
  const named = matchChildren(message, children);
  const contextChild =
    !interrupt && conversation?.event.child
      ? matchChildren(conversation.event.child, children)
      : [];
  const childRecord = named.length === 1 ? named[0] : contextChild.length === 1 ? contextChild[0] : null;

  if (input.intake === "self_forward") {
    return selfForwardResult(message, input.attachmentNames ?? []);
  }

  if (isCancel(message)) {
    const pending = openMessage(conversation);
    return turn({
      handled: true,
      control: "cancel_message",
      reply: pending
        ? "I canceled that message. Nothing was sent."
        : "There isn't a message waiting to send.",
      message,
      summary: "Cancel the pending message.",
      itemType: "note",
      proposals: [proposal("note_only", "Message canceled.")],
      reasoning: "The user canceled a pending co-parent message.",
    });
  }

  const advice = isAdvice(message);
  if (advice === "wording") {
    return turn({
      handled: true,
      reply: "I can help you find the wording. I won't send a message unless you ask me to prepare one.",
      message,
      summary: "Help with wording only.",
      itemType: "note",
      proposals: [proposal("note_only", "Wording help. Nothing to send.")],
      reasoning: "A request for wording is not approval to send.",
    });
  }
  if (advice === "unpaid") {
    return turn({
      handled: true,
      reply:
        "I won't send anything about that. I can log the expense or draft a reminder if you want me to.",
      message,
      summary: "Payment is still open. No message prepared.",
      itemType: "note",
      proposals: [proposal("note_only", "No message. Offer to log an expense or draft a reminder.")],
    reasoning: "An unpaid balance is not a request to message the co-parent.",
  });
  }

  if (isExplicitNoteRequest(message)) {
    return turn({
      handled: true,
      reply: "I saved that as a note. Nothing else was filed, logged, or sent.",
      message,
      summary: "Note",
      itemType: "note",
      proposals: [proposal("note_only", message.trim())],
      reasoning: "The parent asked for a note. No other action was taken.",
    });
  }

  const answered = completeOpenDetail(message, conversation?.memory, input.taskTurn);
  if (answered) return answered;

  if (named.length > 1 && (isCalendarQuestion(message) || wantsCalendar(message) || isEventDetailUpdate(message))) {
    const label = named.map((child) => child.name).join(" and ");
    return turn({
      handled: true,
      reply: `Which ${label} do you mean?`,
      message,
      summary: "More than one child matches that name.",
      itemType: "note",
      proposals: [
        proposal("ask_clarification", `Which ${label} do you mean?`, { audience: "parent" }),
      ],
      status: "awaiting_clarification",
      reasoning: "A child name matched more than one child on the case.",
    });
  }

  const lookup = answerCalendarQuestion({
    message,
    children,
    events,
    viewerId: input.viewerId ?? "",
    today,
    timezone,
  });
  if (lookup) {
    return turn({
      handled: true,
      reply: lookup,
      message,
      summary: lookup,
      itemType: "note",
      proposals: [],
      status: "no_action",
      reasoning: "A calendar question is answered from saved events and does not create a record.",
    });
  }

  const saved = events.find((event) => event.id === conversation?.event.eventId) ?? null;
  if (isEventDetailUpdate(message) && (conversation?.event.subject || conversation?.event.eventId)) {
    const openCalendar = (conversation?.open_proposals ?? []).some((p) => p.type === "calendar_update");
    const nextTime = clockWithMeridiem(message);
    const place = locationPhrase(message);
    const early = earlyArrivalNote(message);
    const cancel = isCancelRequest(message);
    if (openCalendar && nextTime && !place && !early && !cancel) {
      const resolved = resolvedDay(message, today, timezone);
      const label = resolved?.label ?? conversation?.event.date ?? "the same day";
      return turn({
        handled: true,
        control: "revise_pending",
        revision: {
          date: resolved?.iso ?? conversation?.event.date ?? "",
          label: typeof label === "string" ? label : label,
          time: nextTime,
        },
        reply: "Updated the pending calendar suggestion.",
        message,
        summary: "Update the pending event time.",
        itemType: "note",
        proposals: [proposal("note_only", "Pending calendar time updated.")],
        reasoning: "A time correction updates the pending calendar proposal.",
      });
    }
    let targetId = conversation?.event.eventId ?? null;
    let target = saved;
    if (!targetId) {
      const matches = followUpTargets({
        events,
        childId: childRecord?.id ?? null,
        date: conversation.event.date,
        subject: conversation.event.subject,
        timezone,
      });
      if (matches.length === 1) {
        target = matches[0];
        targetId = matches[0].id;
      } else {
        const choices =
          matches.length > 1 ? ` ${matches.map((event) => event.title).join("; ")}.` : "";
        return turn({
          handled: true,
          reply: `Which appointment should I update?${choices}`,
          message,
          summary: "More than one event could match.",
          itemType: "note",
          proposals: [
            proposal("ask_clarification", `Which appointment should I update?${choices}`, {
              audience: "parent",
            }),
          ],
          status: "awaiting_clarification",
          reasoning: "An update needs one saved event.",
        });
      }
    }
    const start =
      nextTime && !early && !cancel ? nextTime : clockWithMeridiem(conversation?.event.time ?? "");
    const description = composeEventDescription({
      existing: target?.description ?? null,
      location: place,
      note: early,
    });
    const subject = conversation.event.subject;
    const child = childRecord?.name ?? conversation.event.child;
    const title = appointmentTitle(child, subject);
    const category = calendarCategory(appointmentSubject(subject ?? "")?.category ?? null);
    return turn({
      handled: true,
      reply: cancel
        ? `I can mark ${title} canceled once you approve it. The time stays the same.`
        : `I can update ${title}. Nothing changes until you approve it.`,
      message,
      summary: cancel ? `Cancel ${title}.` : `Update ${title}.`,
      itemType: "calendar_event",
      child,
      childIds: childRecord ? [childRecord.id] : [],
      dateIso: conversation.event.date,
      eventSubject: subject,
      proposals: [
        proposal("calendar_update", cancel ? `Mark ${title} canceled.` : `Update ${title}.`, {
          calendar_intent: "update",
          calendar_event_id: targetId,
          date: conversation.event.date,
          event_start: start,
          title,
          ...(description ? { description } : {}),
          category: category ?? undefined,
          event_status: cancel ? "canceled" : undefined,
        }),
      ],
      reasoning: "A follow-up updates the saved event instead of creating another.",
    });
  }

  if (isDateCorrection(message, conversation)) {
    const resolved = resolvedDay(message, today, timezone);
    if (resolved) {
      const label = resolved.label;
      const clock = clockFromText(message);
      return turn({
        handled: true,
        control: "revise_pending",
        revision: { date: resolved.iso, label, time: clock?.eventStart ?? null },
        reply: `Updated the pending calendar suggestion to ${label}.`,
        message,
        summary: `Move the pending event to ${label}.`,
        itemType: "note",
        proposals: [proposal("note_only", `Pending calendar date moved to ${label}.`)],
        dateIso: resolved.iso,
        reasoning: "A correction updates the pending calendar proposal instead of adding another.",
      });
    }
  }

  const knownChildren = children.map((child) => ({ id: child.id, name: child.name }));
  if (isDocumentQuestion(message)) {
    const answer = answerDocumentQuestion({
      message,
      documents: input.documents ?? [],
      children: knownChildren,
      today,
      timezone,
      viewer: input.viewerId
        ? { userId: input.viewerId, role: input.viewerRole ?? "parent" }
        : undefined,
    });
    if (answer) {
      return turn({
        handled: true,
        reply: answer,
        message,
        summary: "Document search",
        itemType: "note",
        proposals: [],
        status: "no_action",
        dateIso: null,
        eventSubject: null,
        reasoning: "A document question is answered from saved documents and does not create a record.",
      });
    }
  }

  const openDocuments = openDocumentStates(conversation?.open_proposals);
  let filedDocument = conversation?.recent_document ?? null;
  if (isDocumentEdit(message) && openDocuments.length === 0 && !filedDocument) {
    const picked = pickSavedForEdit(message, input.documents ?? [], knownChildren);
    if (picked.kind === "ask") {
      return turn({
        handled: true,
        reply: picked.question,
        message,
        summary: "Which document should I update?",
        itemType: "note",
        proposals: [proposal("ask_clarification", picked.question, { audience: "parent", clarifies: "document" })],
        status: "awaiting_clarification",
        dateIso: null,
        eventSubject: null,
        reasoning: "More than one saved document could match that follow-up.",
      });
    }
    if (picked.kind === "one") filedDocument = filedDocumentState(picked.document, knownChildren);
  }
  const documentTurn = interpretDocumentTurn({
    text: message,
    children: knownChildren,
    pending: openDocuments[0] ?? null,
    pendingDocuments: openDocuments,
    filed: filedDocument,
    today,
    timezone,
  });
  if (documentTurn.action === "ask") {
    return turn({
      handled: true,
      reply: documentTurn.message,
      message,
      summary: "Which document should I update?",
      itemType: "note",
      proposals: [
        proposal("ask_clarification", documentTurn.message, { audience: "parent", clarifies: "document" }),
      ],
      status: "awaiting_clarification",
      dateIso: null,
      eventSubject: null,
      reasoning: "More than one document could match that follow-up.",
    });
  }
  if (documentTurn.action === "create" || documentTurn.action === "revise") {
    const doc = documentTurn.proposal;
    const fields = {
      title: doc.title,
      description: doc.description,
      category: doc.category,
      visibility: doc.visibility,
      document_child_id: doc.childId,
      document_child_name: doc.childName,
      updatesExisting: doc.updatesExisting,
      ...(doc.fileName ? { attached_file_name: doc.fileName } : {}),
      ...(doc.documentId ? { attached_document_id: doc.documentId } : {}),
    };
    if (documentTurn.action === "revise") {
      return turn({
        handled: true,
        control: "revise_document",
        revision: {
          date: "",
          label: doc.title,
          time: null,
          document: revisionFromProposal(doc),
        },
        reply: documentTurn.reply,
        message,
        summary: documentTurn.reply,
        itemType: "document",
        proposals: [],
        child: doc.childName,
        childIds: doc.childId ? [doc.childId] : [],
        dateIso: null,
        eventSubject: null,
        reasoning: "A follow-up updates the pending document instead of filing another.",
      });
    }
    return turn({
      handled: true,
      reply: documentTurn.reply,
      message,
      summary: doc.title,
      itemType: "document",
      proposals: [
        proposal("log_document", `File “${doc.title}”. ${doc.description}`, {
          ...fields,
          key: doc.key,
        } as Partial<Proposal>),
      ],
      child: doc.childName,
      childIds: doc.childId ? [doc.childId] : [],
      dateIso: null,
      eventSubject: null,
      reasoning: "A document filing stays a document. It is not a calendar event.",
    });
  }
  if (
    documentTurn.action === "none" &&
    isDocumentEdit(message) &&
    /\b(evaluation|document|record|report|file)\b/i.test(message)
  ) {
    return turn({
      handled: true,
      reply: "I don't have a document that matches that.",
      message,
      summary: "No matching document",
      itemType: "note",
      proposals: [],
      status: "no_action",
      dateIso: null,
      eventSubject: null,
      reasoning: "A document follow-up does not become a note when nothing matches.",
    });
  }

  const calendar = wantsCalendar(message);
  const document = wantsDocument(message);
  const expense = wantsExpense(message);
  const notify = resolveNotify(message, coparents, conversation);
  const inheritedEvent = interrupt
    ? { subject: null, child: null, date: null, time: null, eventId: null as string | null }
    : conversation?.event ?? { subject: null, child: null, date: null, time: null, eventId: null };
  const child = childRecord?.name ?? childName(message, coparents) ?? inheritedEvent.child ?? null;
  const childIds = childRecord ? [childRecord.id] : [];
  const subjectConversation =
    interrupt && conversation ? { ...conversation, event: inheritedEvent } : conversation;
  const subject =
    eventSubject(message, subjectConversation) ??
    (calendar ? "event" : null);
  const statedDay = resolvedDay(message, today, timezone);
  const dateIso =
    statedDay?.iso ?? ((calendar || !expense) ? inheritedEvent.date ?? null : null);
  const dateLabel = dateIso ? prettyDate(dateIso) : null;
  const clock = clockFromText(message);
  const messageTime = clockWithMeridiem(message);
  const statedTime = messageTime ?? (clock ? null : clockWithMeridiem(inheritedEvent.time ?? ""));
  const timeLabel = statedTime ? formatClockLabel(statedTime) : clock?.label ?? null;
  const allDay = wantsAllDay(message);
  const completingTime =
    !calendar &&
    !isPaymentReport(message) &&
    Boolean(messageTime) &&
    Boolean(inheritedEvent.subject) &&
    Boolean(inheritedEvent.date) &&
    !isEventDetailUpdate(message);

  const proposals: Proposal[] = [];
  const specific = appointmentSubject(`${message} ${subject ?? ""}`);
  const title = appointmentTitle(child, specific?.subject ?? subject);
  const category = specific?.category ?? null;
  if ((calendar || completingTime) && !statedTime && !allDay) {
    const what = (specific?.subject ?? subject ?? "appointment").toLowerCase();
    const ask = child ? `What time is ${child}'s ${what}?` : `What time is that ${what}?`;
    proposals.push(proposal("ask_clarification", ask, { audience: "parent", clarifies: "calendar" }));
  } else if (calendar || completingTime) {
    const bits = [title, dateLabel, statedTime ? `at ${formatClockLabel(statedTime)}` : allDay ? "all day" : null]
      .filter(Boolean)
      .join(", ");
    proposals.push(
      proposal("calendar_update", `Add to calendar: ${bits || title}.`, {
        calendar_intent: "offer",
        date: dateIso,
        event_start: allDay ? null : statedTime,
        ...(allDay ? { all_day: true } : {}),
        title,
        category: category ?? undefined,
        depends_on: dateIso ? null : "date",
      })
    );
  }
  if (document) {
    proposals.push(
      proposal("log_document", child ? `${child} document` : "Saved from chat", {
        title: child ? `${child} document` : "Saved from chat",
      })
    );
  }
  const expenseAmount = expense ? parseExpenseAmountFromText(message) : null;
  const expenseCategory = expense ? inferExpenseCategoryFromText(message) : null;
  if (expense) {
    const description = expenseDescription(message);
    const payer = detectExpensePayer(
      message,
      coparents,
      children.map((child) => ({ name: child.name }))
    );
    const logging = detectExpenseLoggingIntent(message);
    if (payer.kind === "ask") {
      proposals.push(proposal("ask_clarification", payer.question, { audience: "parent", clarifies: "expense" }));
    } else {
      proposals.push(
        proposal("log_expense", description, {
          description,
          ...(expenseCategory ? { category: expenseCategory } : {}),
          ...(expenseAmount != null ? { amount: expenseAmount } : {}),
          paid_by: payer.kind === "coparent" ? "coparent" : "self",
          ...(payer.kind === "coparent" ? { payer_name: payer.name } : {}),
          sharing_intent: logging.intent,
          ...(logging.statedPercent != null ? { stated_percent: logging.statedPercent } : {}),
          ...(logging.notify != null ? { notify_coparent: logging.notify } : {}),
          ...(logging.conflict ? { sharing_conflict: true } : {}),
        })
      );
    }
  }
  if (notify.kind === "one") {
    const email = notify.coparent.email?.trim() || "";
    if (!email) {
      proposals.push(
        proposal(
          "ask_clarification",
          `I don't have a delivery email for ${notify.coparent.name}. Add one and I can prepare the message.`,
          { audience: "parent", clarifies: "message", recipient_name: notify.coparent.name }
        )
      );
    } else {
      // A message card may reuse calendar wording only for an event this turn schedules, or one
      // the session already holds. A medical noun in a request to write is not a scheduled event.
      const scheduleEstablished =
        Boolean(inheritedEvent.date || inheritedEvent.time || inheritedEvent.eventId) ||
        (conversation?.open_proposals ?? []).some((item) => item.type === "calendar_update");
      const notifyFromCalendar = calendar || completingTime || scheduleEstablished;
      const body = notifyFromCalendar
        ? messageBody({
            child,
            subject: calendar || completingTime ? subject : inheritedEvent.subject,
            dateLabel: calendar || completingTime ? dateLabel : inheritedEvent.date ? prettyDate(inheritedEvent.date) : dateLabel,
            timeLabel: calendar || completingTime ? timeLabel : inheritedEvent.time ?? timeLabel,
          })
        : null;
      if (!body) {
        proposals.push(
          proposal(
            "ask_clarification",
            `What should I tell ${notify.coparent.name}? I won't invent the details.`,
            {
              audience: "parent",
              clarifies: "message",
              recipient_name: notify.coparent.name,
              ...(email ? { recipient_email: email } : {}),
            }
          )
        );
      } else {
        proposals.push(
          proposal("reply_coparent", body, {
            recipient_name: notify.coparent.name,
            recipient_email: email,
            subject: subject,
            draft_origin: "sage_wording",
          })
        );
      }
    }
  } else if (notify.kind === "clarify") {
    proposals.push(proposal("ask_clarification", notify.reply, { audience: "parent", clarifies: "message" }));
  }

  const prepared = finalizeExpenseProposals([...proposals], message, today, timezone);
  proposals.length = 0;
  proposals.push(...prepared);

  if (proposals.length === 0) {
    return turn({
      handled: false,
      reply: "",
      message,
      summary: message,
      itemType: "note",
      proposals: [],
      status: "no_action",
      reasoning: "No structured action. The conversational engine can answer.",
    });
  }

  const hasMessage = proposals.some((p) => p.type === "reply_coparent");
  const hasCalendar = proposals.some((p) => p.type === "calendar_update");
  const hasExpense = proposals.some((p) => p.type === "log_expense");
  const timeAsk = proposals.find((p) => p.type === "ask_clarification" && p.audience === "parent");
  const recipient = proposals.find((p) => p.type === "reply_coparent");
  let reply = "I prepared that for your approval.";
  if (hasCalendar && hasExpense) {
    reply = "I prepared a calendar event and an expense. Each one needs your approval.";
  } else if (hasExpense && timeAsk?.draft) {
    reply = `${timeAsk.draft} I can also log the expense once you approve it.`;
  } else if (hasCalendar && hasMessage && recipient?.recipient_name) {
    reply = `I prepared a calendar event and a separate message to ${recipient.recipient_name}. Each one needs your approval.`;
  } else if (hasMessage && recipient?.recipient_name) {
    reply = `Here is a message to ${recipient.recipient_name}. Nothing is sent until you choose Send.`;
  } else if (hasCalendar) {
    reply = "I can add that to the calendar.";
    const named = coparents.length === 1 ? coparents[0].name : null;
    if (!hasMessage && named && transitionEvent(message) && notify.kind === "none") {
      reply += ` Would you also like to notify ${named}?`;
    }
  } else if (proposals.some((p) => p.type === "log_document")) {
    reply = "I can save that as a document once you approve it.";
  } else if (proposals.some((p) => p.type === "log_expense")) {
    reply = "I can log that expense once you approve it.";
  } else if (proposals.some((p) => p.type === "ask_clarification")) {
    reply = proposals.find((p) => p.type === "ask_clarification")?.draft ?? reply;
  }

  const calendarClarification = proposals.some(
    (item) => item.type === "ask_clarification" && item.clarifies === "calendar"
  );
  const itemType = hasCalendar
    ? "calendar_event"
    : hasMessage
      ? "message"
      : document
        ? "document"
        : expense
          ? "expense"
          : calendarClarification
            ? "calendar_event"
            : "note";

  return turn({
    handled: true,
    reply,
    message,
    summary: reply,
    itemType,
    proposals,
    child,
    childIds,
    dateIso: expense && !calendar && !completingTime ? null : dateIso,
    eventSubject: calendar || completingTime ? specific?.subject ?? subject : null,
    amount: expenseAmount,
    expenseCategory,
    status: proposals.every((p) => p.type === "ask_clarification")
      ? "awaiting_clarification"
      : undefined,
    reasoning: "Chat intent prepared approval cards and did not execute them.",
  });
}

export function cancelPendingMessages(
  proposals: unknown[],
  nowIso: string
): { proposals: unknown[]; canceled: number } {
  let canceled = 0;
  const next = proposals.map((raw) => {
    if (!raw || typeof raw !== "object") return raw;
    const current = raw as Record<string, unknown>;
    if (current.type !== "reply_coparent") return raw;
    if (isInactiveProposal(current) || current.executed === true) return raw;
    canceled += 1;
    return { ...current, status: "canceled", waived_at: nowIso };
  });
  return { proposals: next, canceled };
}

export function revisePendingCalendar(
  proposals: unknown[],
  revision: PendingRevision
): { proposals: unknown[]; changed: boolean } {
  let index = -1;
  for (let i = proposals.length - 1; i >= 0; i -= 1) {
    const raw = proposals[i];
    if (!raw || typeof raw !== "object") continue;
    const current = raw as Record<string, unknown>;
    if (current.type !== "calendar_update" || isInactiveProposal(current)) continue;
    index = i;
    break;
  }
  if (index < 0) return { proposals, changed: false };
  const current = proposals[index] as { draft?: string };
  const base = (current.draft ?? "").replace(/\s*Date updated to .+$/i, "").trim();
  const draft = `${base} Date updated to ${revision.label}.`.trim();
  const revised = reviseProposal(proposals, index, {
    draft,
    date: revision.date,
    ...(revision.time ? { event_start: revision.time } : {}),
  });
  if (!revised) return { proposals, changed: false };
  return { proposals: revised.proposals, changed: true };
}
