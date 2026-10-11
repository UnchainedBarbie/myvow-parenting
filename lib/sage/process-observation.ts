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
  const resolved_dates = resolveDates(
    entities.dates.map((d) => ({ raw: rawForDateResolver(d) })),
    today,
    context.timezone,
    observationText
  );
  if (
    !resolved_dates.some((d) => d.status === "resolved" && d.iso) &&
    /\b(?:this|next)?(?:\s+coming)?\s*(?:sun|sunday|mon|monday|tue|tues|tuesday|wed|wednesday|thu|thur|thurs|thursday|fri|friday|sat|saturday)\b/i.test(
      observationText
    )
  ) {
    const fromText = resolveDate(
      observationText,
      today,
      context.timezone,
      observationText
    );
    if (fromText.status === "resolved" && fromText.iso) {
      resolved_dates.push(fromText);
    }
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
  const itemPlan = await reconcileCalendarPlan(draftedPlan, {
    caseId: context.case_id,
    timezone: context.timezone,
    iso: resolvedIso,
    childIds: child_ids,
    summary: intent.summary,
    corpus: observationText,
  });

  return {
    observation,
    interpretation,
    child_ids,
    unresolved_children,
    resolved_dates,
    plan: itemPlan,
    expense_category: intent.item_type === "expense" ? expense_category : undefined,
  };
}
