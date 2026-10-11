/**
 * Sage Engine — shared observation processing pipeline.
 * interpret → resolveChildren + resolveDates → plan.
 * No writes. Adapters (email, chat) call this then persist/respond as needed.
 */

import {
  formatObservationForUnderstanding,
  type Observation,
} from "@/lib/sage/observation-builder";
import { reconcileCalendarPlan } from "@/lib/sage/calendar-match";
import { eventSubjectFromTexts, preferEventSubject } from "@/lib/sage/event-subject";
import { plan, type Plan } from "@/lib/sage/planner";
import {
  rawForDateResolver,
  resolveChildren,
  resolveDate,
  resolveDates,
  type DateResolution,
} from "@/lib/sage/resolver";
import {
  interpret,
  type SageInterpretation,
} from "@/lib/sage/understanding";
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
   * Date already resolved earlier in this session or thread.
   * Used only when this turn's own message has no date.
   */
  established_date?: { iso: string; raw: string } | null;
  /** More specific event subject from earlier in the conversation, if any. */
  established_subject?: string | null;
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
  const observationText = formatObservationForUnderstanding(observation);

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
  const categoryBlob = [
    intent.summary,
    intent.evidence_excerpt,
    observationText,
  ]
    .filter(Boolean)
    .join(" ");

  // Dentist/doctor bills are expenses (medical), not calendar-only medical_update.
  if (
    intent.item_type !== "expense" &&
    (intent.tool_name === "expense" || looksLikeExpenseCommand(categoryBlob))
  ) {
    intent.item_type = "expense";
    intent.tool_name = "expense";
    intent.action_required = true;
  }

  const childNames = entities.children
    .map((c) => c.name)
    .filter((n) => typeof n === "string" && n.trim().length > 0);
  const { child_ids, resolved: childResolutions } = await resolveChildren(
    context.case_id,
    childNames
  );
  const unresolved_children = childResolutions
    .filter((r) => r.child_id === null)
    .map((r) => r.name);

  const today = context.today ?? new Date();
  const messageBodies = observation.messages
    .map((m) => m.text.trim())
    .filter(Boolean)
    .join("\n");
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

  const established = context.established_date;
  if (
    !resolved_dates.some((d) => d.status === "resolved" && d.iso) &&
    established?.iso &&
    /^\d{4}-\d{2}-\d{2}$/.test(established.iso)
  ) {
    resolved_dates.push({
      raw: established.raw || established.iso,
      status: "resolved",
      iso: established.iso,
      reason: "Inherited from earlier in the conversation",
    });
    console.log(
      "[sage/dates]",
      JSON.stringify({
        source_type: context.source_type,
        inherited: { raw: established.raw, iso: established.iso, source: "conversation" },
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
      : parseExpenseAmountFromText(categoryBlob);
  if (
    amount != null &&
    !entities.amounts.some((a) => a.value === amount)
  ) {
    entities.amounts = [{ value: amount, currency: "USD" }, ...entities.amounts];
  }

  let expense_allocation: {
    other_parent_share: number | null;
    allocation_status?: string;
    notify_coparent?: boolean;
  } | undefined;
  if (intent.item_type === "expense") {
    const notify_coparent = userAskedToNotifyCoparent(observationText);
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
        notify_coparent,
      };
    } else {
      expense_allocation = {
        other_parent_share: 0,
        allocation_status: "NONE",
        notify_coparent,
      };
    }
  }

  const hasAttachments =
    observation.messages.some((m) => (m.attachments?.length ?? 0) > 0) ||
    /\[Attachment:/i.test(observationText);

  const draftedPlan = await plan({
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
  });
  const resolvedIso =
    resolved_dates.find((d) => d.status === "resolved" && d.iso)?.iso ?? null;
  const event_subject =
    preferEventSubject(
      eventSubjectFromTexts([messageBodies, intent.evidence_excerpt ?? ""]),
      context.established_subject ?? null
    ) ?? undefined;
  const childName = childResolutions.find((r) => r.child_id)?.name
    ?? childNames[0]
    ?? null;
  const itemPlan = await reconcileCalendarPlan(draftedPlan, {
    caseId: context.case_id,
    timezone: context.timezone,
    iso: resolvedIso,
    childIds: child_ids,
    summary: intent.summary,
    corpus: messageBodies,
    subject: event_subject ?? null,
    childName,
  });

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
