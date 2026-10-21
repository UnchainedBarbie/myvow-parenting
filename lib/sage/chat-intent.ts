/**
 * Deterministic routing for a Sage chat turn.
 * Uses the message, the open conversation, and the known co-parent.
 * Proposes only. Nothing here sends, files, or writes.
 */

import type { ConversationContext } from "@/lib/sage/conversation-context";
import type { Observation } from "@/lib/sage/observation-builder";
import type { Plan, Proposal } from "@/lib/sage/planner";
import { isInactiveProposal, reviseProposal } from "@/lib/sage/proposal-lifecycle";
import type { ProcessObservationResult } from "@/lib/sage/process-observation";
import { formatClockLabel } from "@/lib/sage/event-subject";
import { resolveDate } from "@/lib/sage/resolver";
import type { SageInterpretation } from "@/lib/sage/understanding";

export type KnownCoparent = {
  name: string;
  email: string | null;
};

export type ChatControl = "none" | "cancel_message" | "revise_pending";

export type PendingRevision = {
  date: string;
  label: string;
  time: string | null;
};

export type RoutedTurn = {
  handled: boolean;
  control: ChatControl;
  reply: string;
  revision: PendingRevision | null;
  result: ProcessObservationResult;
};

export type RouteChatIntentInput = {
  message: string;
  conversation?: ConversationContext | null;
  coparents?: KnownCoparent[];
  /** A forwarded email is private intake until the user asks for an action. */
  intake?: "chat" | "self_forward";
  timezone?: string;
  today?: Date;
  attachmentNames?: string[];
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
  const lower = text.toLowerCase();
  if (/\bschool\b/.test(lower)) return "school";
  if (/\b(ot|occupational therapy)\b/.test(lower)) return "OT appointment";
  if (/\bappointment\b/.test(lower)) return "appointment";
  if (/\bpickup|pick-up|pick up\b/.test(lower)) return "pickup";
  if (/\bdrop-?off|drop off\b/.test(lower)) return "drop-off";
  if (/\bpractice\b/.test(lower)) return "practice";
  if (/\brecital\b/.test(lower)) return "recital";
  if (/\btherapy\b/.test(lower)) return "therapy";
  return conversation?.event.subject ?? null;
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

function wantsNotify(text: string): boolean {
  const lower = text.toLowerCase();
  if (/\btell me\b/.test(lower) && !/\b(him|her|them)\b/.test(lower) && !refersToCoparentRole(text)) {
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

function wantsCalendar(text: string): boolean {
  const lower = text.toLowerCase();
  const hasWhen =
    new RegExp(`\\b(${WEEKDAY})\\b`).test(lower) ||
    clockFromText(text) != null;
  const hasEvent =
    /\b(school|appointment|practice|pickup|pick-up|pick up|drop-?off|drop off|recital|game|therapy|dentist|doctor|ot|class|event|calendar)\b/.test(
      lower
    );
  const asksAdd = /\b(add|put|schedule|calendar)\b/.test(lower);
  return (hasWhen && hasEvent) || (asksAdd && (hasEvent || hasWhen));
}

function wantsDocument(text: string): boolean {
  return /\b(save|file|store)\b[^.?]{0,40}\b(document|documents)\b/i.test(text) ||
    /\bfile (this|that|it)\b/i.test(text);
}

function wantsExpense(text: string): boolean {
  return /\blog (this |that |the )?(expense|receipt)\b/i.test(text) ||
    /\b(add|enter|record) (this |that |an |the )?expense\b/i.test(text);
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
      amounts: [],
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
    child_ids: [],
    unresolved_children: opts.child ? [opts.child] : [],
    resolved_dates: opts.dateIso
      ? [{ raw: opts.dateIso, status: "resolved", iso: opts.dateIso, reason: "chat-intent" }]
      : [],
    plan: opts.plan,
    event_subject: opts.eventSubject ?? undefined,
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
  reasoning: string;
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
    result: shell({
      message: opts.message,
      summary: opts.summary,
      itemType: opts.itemType,
      plan,
      child: opts.child ?? null,
      dateIso: opts.dateIso ?? null,
      eventSubject: opts.eventSubject ?? null,
    }),
  };
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

export function routeChatIntent(input: RouteChatIntentInput): RoutedTurn {
  const message = input.message ?? "";
  const conversation = input.conversation ?? null;
  const coparents = input.coparents ?? [];
  const timezone = input.timezone ?? "America/Denver";
  const today = input.today ?? new Date();

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

  const calendar = wantsCalendar(message);
  const document = wantsDocument(message);
  const expense = wantsExpense(message);
  const notify = resolveNotify(message, coparents, conversation);
  const child = childName(message, coparents) ?? conversation?.event.child ?? null;
  const subject =
    eventSubject(message, conversation) ??
    (calendar ? "event" : null);
  const resolved = resolvedDay(message, today, timezone);
  const dateIso = resolved?.iso ?? conversation?.event.date ?? null;
  const dateLabel = dateIso ? prettyDate(dateIso) : null;
  const clock = clockFromText(message);
  const timeLabel = clock?.label ?? conversation?.event.time ?? null;

  const proposals: Proposal[] = [];
  if (calendar) {
    const bits = [child, subject !== "event" ? subject : null, dateLabel, timeLabel ? `at ${timeLabel}` : null]
      .filter(Boolean)
      .join(", ");
    proposals.push(
      proposal("calendar_update", `Add to calendar: ${bits || "event"}.`, {
        calendar_intent: "offer",
        date: dateIso,
        event_start: clock?.eventStart ?? null,
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
  if (expense) {
    proposals.push(proposal("log_expense", "Log expense from this conversation."));
  }
  if (notify.kind === "one") {
    const email = notify.coparent.email?.trim() || "";
    if (!email) {
      proposals.push(
        proposal(
          "ask_clarification",
          `I don't have a delivery email for ${notify.coparent.name}. Add one and I can prepare the message.`,
          { audience: "parent" }
        )
      );
    } else {
      const body = messageBody({
        child,
        subject,
        dateLabel,
        timeLabel,
      });
      if (!body) {
        proposals.push(
          proposal(
            "ask_clarification",
            `What should I tell ${notify.coparent.name}? I won't invent the details.`,
            { audience: "parent" }
          )
        );
      } else {
        proposals.push(
          proposal("reply_coparent", body, {
            recipient_name: notify.coparent.name,
            recipient_email: email,
            subject: subject,
          })
        );
      }
    }
  } else if (notify.kind === "clarify") {
    proposals.push(proposal("ask_clarification", notify.reply, { audience: "parent" }));
  }

  if (proposals.length === 0) {
    return turn({
      handled: false,
      reply: "",
      message,
      summary: message,
      itemType: "note",
      proposals: [proposal("note_only", message)],
      reasoning: "No structured action. The conversational engine can answer.",
    });
  }

  const hasMessage = proposals.some((p) => p.type === "reply_coparent");
  const hasCalendar = proposals.some((p) => p.type === "calendar_update");
  const recipient = proposals.find((p) => p.type === "reply_coparent");
  let reply = "I prepared that for your approval.";
  if (hasCalendar && hasMessage && recipient?.recipient_name) {
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

  const itemType = hasCalendar
    ? "calendar_event"
    : hasMessage
      ? "message"
      : document
        ? "document"
        : expense
          ? "expense"
          : "note";

  return turn({
    handled: true,
    reply,
    message,
    summary: reply,
    itemType,
    proposals,
    child,
    dateIso,
    eventSubject: subject,
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
