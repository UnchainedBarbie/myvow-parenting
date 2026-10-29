/**
 * Sage Engine — shared observation processing pipeline.
 * interpret → resolveChildren + resolveDates → plan.
 * No writes. Adapters (email, chat) call this then persist/respond as needed.
 */

import { resolveAskedDetail } from "@/lib/sage/ledger-facts";
import {
  formatObservationForUnderstanding,
  isUserCommand,
  type Observation,
} from "@/lib/sage/observation-builder";
import { detectDetailQuestion } from "@/lib/sage/outbound-facts";
import { reconcileCalendarPlan } from "@/lib/sage/calendar-match";
import {
  bareCorrection,
  formatConversationContext,
  hasEstablishedEvent,
  missingEventQuestion,
  type ConversationContext,
} from "@/lib/sage/conversation-context";
import { eventSubjectFromTexts, preferEventSubject } from "@/lib/sage/event-subject";
import { plan, type Plan } from "@/lib/sage/planner";
import {
  rawForDateResolver,
  resolveChildren,
  parseClockMinutes,
  resolveDate,
  resolveDates,
  type DateResolution,
} from "@/lib/sage/resolver";
import {
  interpret,
  type SageInterpretation,
} from "@/lib/sage/understanding";
import { finalizeExpenseProposals } from "@/lib/sage/expense-date";
import { computeAllocationFromParentingPlan } from "@/lib/expenses-allocation";
import {
  inferExpenseCategoryFromText,
  looksLikeExpenseCommand,
  parseExpenseAmountFromText,
  userAskedToNotifyCoparent,
} from "@/lib/expenses-share";

export type ObservationProcessContext = {
  case_id: string;
  timezone: string;
  source_type: string;
  source_id: string | null;
  /** Sender label passed to Understanding (e.g. "Co-Parent", "You"). */
  sender: string;
  /**
   * Sender label passed to Planner. Email keeps "Co-Parent" for drafts;
   * chat typically uses "You". Defaults to sender.
   */
  plan_sender?: string;
  /** Optional override for "today" in date resolution (tests). */
  today?: Date;
  /**
   * Compact context for a chat turn. Date, subject, and child already
   * established in the session come from here — not from a separate carry-forward.
   */
  conversation?: ConversationContext | null;
};

export type ProcessObservationResult = {
  observation: Observation;
  interpretation: SageInterpretation;
  child_ids: string[];
  unresolved_children: string[];
  resolved_dates: DateResolution[];
  plan: Plan;
  /** Derived category used for allocation and form prefill (e.g. dentist → medical). */
  expense_category?: string;
  /** Event itself ("Choir concert"), not a sentence Sage wrote. */
  event_subject?: string;
};

/**
 * Run the core Sage stages on a built Observation.
 * Returns the assembled interpretation + resolution + plan (sage_item field sources).
 */
export async function processObservation(
  observation: Observation,
  context: ObservationProcessContext
): Promise<ProcessObservationResult> {
  const turnText = formatObservationForUnderstanding(observation);
  const contextBlock = context.conversation
    ? formatConversationContext(context.conversation)
    : "";
  const observationText = contextBlock ? `${contextBlock}\n\n${turnText}` : turnText;

  const interpretation = await interpret({
    source_type: context.source_type,
    source_id: context.source_id,
    case_id: context.case_id,
    sender: context.sender,
    text: observationText,
    attachments:
      observation.messages[observation.messages.length - 1]?.attachments,
  });

  const { intent, entities } = interpretation;
  const scheduleItem =
    intent.item_type === "schedule_change" || intent.item_type === "calendar_update";
  console.log(
    "[sage/understanding]",
    JSON.stringify({
      source_type: context.source_type,
      item_type: intent.item_type,
      domain: intent.domain,
      action_required: intent.action_required,
      action_type: intent.action_type,
      tool_name: intent.tool_name,
      summary: intent.summary,
      children: entities.children,
      dates: entities.dates,
      schedule_item: scheduleItem,
      context: contextBlock || null,
    })
  );
  // The words of this turn only. The conversation block carries Sage's own earlier questions and
  // proposals ("What was the amount of this expense?"); scanning them would let Sage's wording
  // classify the parent's next message. Detection reads what the sender wrote now.
  const messageBodies = observation.messages
    .map((m) => m.text.trim())
    .filter(Boolean)
    .join("\n");
  // Category labels read the model's summary of this turn as well, after the turn is classified.
  const categoryBlob = [intent.summary, intent.evidence_excerpt, messageBodies]
    .filter(Boolean)
    .join(" ");

  // Dentist/doctor bills are expenses (medical), not calendar-only medical_update.
  if (
    intent.item_type !== "expense" &&
    (intent.tool_name === "expense" || looksLikeExpenseCommand(messageBodies))
  ) {
    intent.item_type = "expense";
    intent.tool_name = "expense";
    intent.action_required = true;
  }

  const childNames = entities.children
    .map((c) => c.name)
    .filter((n) => typeof n === "string" && n.trim().length > 0);
  let { child_ids, resolved: childResolutions } = await resolveChildren(
    context.case_id,
    childNames
  );
  if (child_ids.length === 0 && context.conversation?.event.child?.trim()) {
    const carried = context.conversation.event.child.trim();
    const extra = await resolveChildren(context.case_id, [carried]);
    if (extra.child_ids.length > 0) {
      child_ids = extra.child_ids;
      childResolutions = extra.resolved;
    }
    if (!entities.children.some((c) => c.name?.trim())) {
      entities.children = [{ name: carried, confidence: 1 }];
    }
  }
  const unresolved_children = childResolutions
    .filter((r) => r.child_id === null)
    .map((r) => r.name);

  const today = context.today ?? new Date();
  const resolved_dates = resolveDates(
    entities.dates.map((d) => ({ raw: rawForDateResolver(d) })),
    today,
    context.timezone,
    messageBodies
  );
  if (
    !resolved_dates.some((d) => d.status === "resolved" && d.iso) &&
    /\b(?:this|next)?(?:\s+coming)?\s*(?:sun|sunday|mon|monday|tue|tues|tuesday|wed|wednesday|thu|thur|thurs|thursday|fri|friday|sat|saturday)\b/i.test(
      messageBodies
    )
  ) {
    const fromText = resolveDate(
      messageBodies,
      today,
      context.timezone,
      messageBodies
    );
    if (fromText.status === "resolved" && fromText.iso) {
      resolved_dates.push(fromText);
    }
  }

  const stamp = observationStamp(observation);
  console.log(
    "[sage/dates]",
    JSON.stringify({
      source_type: context.source_type,
      stamp,
      resolved: resolved_dates.map((d) => ({
        raw: d.raw,
        status: d.status,
        iso: d.iso,
        reason: d.reason,
        source: dateSource(d.raw, messageBodies, stamp),
      })),
    })
  );

  const fromMessage = resolved_dates.filter(
    (d) => dateSource(d.raw, messageBodies, stamp) === "message"
  );
  resolved_dates.length = 0;
  resolved_dates.push(...fromMessage);

  const completedExpense =
    intent.item_type === "expense" || looksLikeExpenseCommand(messageBodies);
  if (completedExpense) {
    for (let i = resolved_dates.length - 1; i >= 0; i -= 1) {
      if (resolved_dates[i].status === "needs_clarification") resolved_dates.splice(i, 1);
    }
  }

  const contextDate = context.conversation?.event.date ?? null;
  if (
    !completedExpense &&
    !resolved_dates.some((d) => d.status === "resolved" && d.iso) &&
    contextDate &&
    /^\d{4}-\d{2}-\d{2}$/.test(contextDate)
  ) {
    resolved_dates.push({
      raw: contextDate,
      status: "resolved",
      iso: contextDate,
      reason: "From conversation context",
    });
    console.log(
      "[sage/dates]",
      JSON.stringify({
        source_type: context.source_type,
        inherited: { iso: contextDate, source: "conversation" },
      })
    );
  }

  const expense_category = inferExpenseCategoryFromText(
    categoryBlob,
    intent.domain
  );
  if (intent.item_type === "expense" && expense_category === "medical") {
    intent.domain = "medical";
  }

  const entityAmount = entities.amounts[0]?.value;
  const amount =
    typeof entityAmount === "number" && Number.isFinite(entityAmount) && entityAmount > 0
      ? entityAmount
      : parseExpenseAmountFromText(messageBodies);
  if (
    amount != null &&
    !entities.amounts.some((a) => a.value === amount)
  ) {
    entities.amounts = [{ value: amount, currency: "USD" }, ...entities.amounts];
  }

  let expense_allocation: {
    other_parent_share: number | null;
    allocation_status?: string;
    split_label?: string | null;
    clarification?: string | null;
    notify_coparent?: boolean;
  } | undefined;
  if (intent.item_type === "expense") {
    const notify_coparent = userAskedToNotifyCoparent(messageBodies);
    if (typeof amount === "number" && Number.isFinite(amount) && amount > 0) {
      const allocation = await computeAllocationFromParentingPlan({
        caseId: context.case_id,
        amount,
        category: expense_category,
        childId: child_ids[0] ?? null,
      });
      expense_allocation = {
        other_parent_share: allocation.other_parent_share,
        allocation_status: allocation.allocation_status,
        split_label: allocation.split_label,
        clarification: allocation.clarification,
        notify_coparent,
      };
    } else {
      expense_allocation = {
        other_parent_share: null,
        allocation_status: "UNRESOLVED",
        clarification: "What was the amount of this expense?",
        notify_coparent,
      };
    }
  }

  const hasAttachments =
    observation.messages.some((m) => (m.attachments?.length ?? 0) > 0) ||
    /\[Attachment:/i.test(turnText);

  const inbound = !isUserCommand({
    sender: context.plan_sender ?? context.sender,
    source_type: context.source_type,
  });
  const asked = inbound ? detectDetailQuestion(messageBodies) : null;
  const lookupIso =
    resolved_dates.find((d) => d.status === "resolved" && d.iso)?.iso ?? null;
  const lookupSubject = preferEventSubject(
    eventSubjectFromTexts([messageBodies]),
    context.conversation?.event.subject ?? null
  );
  let recordLine: string | null = null;
  let ledgerText = "";
  if (asked) {
    const found = await resolveAskedDetail({
      caseId: context.case_id,
      timezone: context.timezone,
      iso: lookupIso,
      childIds: child_ids,
      corpus: messageBodies,
      subject: asked.subject ?? lookupSubject,
      asked,
      conversation: context.conversation ?? null,
    });
    recordLine = found.recordLine;
    ledgerText = found.ledgerText;
    console.log(
      "[sage/outbound]",
      JSON.stringify({
        asked: asked.kind,
        subject: asked.subject,
        record: recordLine,
      })
    );
  }
  const outboundSources = [messageBodies, contextBlock, ledgerText]
    .map((part) => part.trim())
    .filter(Boolean)
    .join("\n");

  let draftedPlan = await plan({
    item_type: intent.item_type,
    domain: intent.domain,
    action_required: intent.action_required,
    action_type: intent.action_type,
    summary: intent.summary,
    has_attachments: hasAttachments,
    child_ids,
    unresolved_children,
    resolved_dates: resolved_dates.map((d) => ({
      raw: d.raw,
      status: d.status,
      iso: d.iso,
    })),
    sender: context.plan_sender ?? context.sender,
    source_type: context.source_type,
    expense_allocation,
    outbound_sources: outboundSources,
    detail_request: asked
      ? { question: asked.question, record_line: recordLine }
      : null,
  });
  const resolvedIso =
    resolved_dates.find((d) => d.status === "resolved" && d.iso)?.iso ?? null;
  const event_subject =
    preferEventSubject(
      eventSubjectFromTexts([messageBodies, intent.evidence_excerpt ?? ""]),
      context.conversation?.event.subject ?? null
    ) ?? undefined;
  const namedChild = childResolutions.find((r) => r.child_id)?.name
    ?? childNames[0]
    ?? null;
  const childName = namedChild ?? context.conversation?.event.child ?? null;
  const correction = bareCorrection(messageBodies);
  const knownEvent = hasEstablishedEvent(context.conversation);
  if (correction && !knownEvent) {
    draftedPlan = {
      status: "awaiting_clarification",
      proposals: [
        {
          type: "ask_clarification",
          draft: missingEventQuestion(correction),
          depends_on: null,
          requires_approval: true,
        },
      ],
      reasoning: "The turn names a value and the session has no event under discussion.",
    };
  }
  const clockMinutes = parseClockMinutes(messageBodies);
  const alreadyCalendar = draftedPlan.proposals.some((p) => p.type === "calendar_update");
  const correctionNeedsCalendar =
    !!correction &&
    knownEvent &&
    (correction.kind === "time" || correction.kind === "date" || correction.kind === "place");
  if (correction && knownEvent) {
    draftedPlan = {
      ...draftedPlan,
      proposals: draftedPlan.proposals.filter(
        (p) => p.type !== "note_only" && p.type !== "ask_clarification"
      ),
    };
  }
  if (!alreadyCalendar && resolvedIso && event_subject && (clockMinutes != null || correctionNeedsCalendar)) {
    draftedPlan = {
      ...draftedPlan,
      status: "ready",
      proposals: [
        ...draftedPlan.proposals.filter((p) => p.type !== "note_only"),
        {
          type: "calendar_update",
          draft: `Add ${event_subject} on ${resolvedIso}.`,
          depends_on: null,
          requires_approval: true,
        },
      ],
      reasoning: `${draftedPlan.reasoning} Date and time confirmed for ${event_subject} — calendar check runs alongside any reply revision.`.trim(),
    };
  }
  const reconciled = await reconcileCalendarPlan(draftedPlan, {
    caseId: context.case_id,
    timezone: context.timezone,
    iso: resolvedIso,
    childIds: child_ids,
    summary: intent.summary,
    corpus: messageBodies,
    subject: event_subject ?? null,
    childName,
  });
  const proposals = finalizeExpenseProposals(
    reconciled.proposals,
    messageBodies,
    today,
    context.timezone
  );
  const waiting = proposals.some((proposal) => proposal.type === "ask_clarification");
  const itemPlan = {
    ...reconciled,
    proposals,
    status:
      !waiting &&
      reconciled.status === "awaiting_clarification" &&
      proposals.some((proposal) => proposal.type === "log_expense")
        ? "ready"
        : reconciled.status,
  };

  return {
    observation,
    interpretation,
    child_ids,
    unresolved_children,
    resolved_dates,
    plan: itemPlan,
    expense_category: intent.item_type === "expense" ? expense_category : undefined,
    event_subject,
  };
}

function observationStamp(observation: Observation): string {
  const last = observation.messages[observation.messages.length - 1];
  if (!last?.timestamp) return "";
  const d = new Date(last.timestamp);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleString("en-US", { month: "short", day: "numeric" });
}

function rawInText(raw: string, text: string): boolean {
  const needle = raw.trim().toLowerCase();
  if (!needle || !text.trim()) return false;
  return text.toLowerCase().includes(needle);
}

/** message = the user wrote it. observation-timestamp = the "From: You (Oct 11)" stamp. */
function dateSource(raw: string, bodies: string, stamp: string): "message" | "observation-timestamp" | "not-in-message" {
  if (rawInText(raw, bodies)) return "message";
  if (stampMatchesRaw(raw, stamp)) return "observation-timestamp";
  return "not-in-message";
}

function stampMatchesRaw(raw: string, stamp: string): boolean {
  const match = stamp.trim().match(/^([A-Za-z]+)\s+(\d{1,2})$/);
  if (!match) return false;
  const text = raw.toLowerCase();
  const mon = match[1].toLowerCase().slice(0, 3);
  const day = String(Number(match[2]));
  if (!text.includes(mon)) return false;
  return new RegExp(`\\b${day}\\b`).test(text);
}
