/**
 * Sage Engine — shared observation processing pipeline.
 * interpret → resolveChildren + resolveDates → plan.
 * No writes. Adapters (email, chat) call this then persist/respond as needed.
 */

import {
  formatObservationForUnderstanding,
  type Observation,
} from "@/lib/sage/observation-builder";
import { plan, type Plan } from "@/lib/sage/planner";
import {
  resolveChildren,
  resolveDates,
  type DateResolution,
} from "@/lib/sage/resolver";
import {
  interpret,
  type SageInterpretation,
} from "@/lib/sage/understanding";

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

  const resolved_dates = resolveDates(
    entities.dates.map((d) => ({ raw: d.raw })),
    context.today ?? new Date(),
    context.timezone
  );

  const itemPlan = await plan({
    item_type: intent.item_type,
    domain: intent.domain,
    action_required: intent.action_required,
    summary: intent.summary,
    child_ids,
    unresolved_children,
    resolved_dates: resolved_dates.map((d) => ({
      raw: d.raw,
      status: d.status,
      iso: d.iso,
    })),
    sender: context.plan_sender ?? context.sender,
    source_type: context.source_type,
  });

  return {
    observation,
    interpretation,
    child_ids,
    unresolved_children,
    resolved_dates,
    plan: itemPlan,
  };
}
