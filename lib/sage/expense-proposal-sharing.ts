import {
  planExpenseEntry,
  type ExpenseLoggingIntent,
  type SharingResult,
} from "@/lib/expenses-sharing";
import type { Proposal } from "@/lib/sage/planner";

export type StampedExpense = { kind: "proposal"; proposal: Proposal };

/** Same share decision a manual save uses, written onto the approval card. Does not save. */
export function stampExpenseProposal(
  proposal: Proposal,
  result: SharingResult
): StampedExpense {
  const amount = typeof proposal.amount === "number" ? proposal.amount : Number.NaN;
  const intent: ExpenseLoggingIntent = proposal.sharing_intent ?? "unspecified";
  const plan = planExpenseEntry({
    intent,
    statedPercent: proposal.stated_percent ?? null,
    notifyOverride: proposal.notify_coparent ?? null,
    conflict: proposal.sharing_conflict === true,
    allocation: result,
    amount,
    payer: proposal.paid_by === "coparent" ? "coparent" : "self",
    payerName: proposal.payer_name,
  });
  return {
    kind: "proposal",
    proposal: {
      ...proposal,
      requires_approval: true,
      sharing_mode: plan.mode,
      sharing_intent: intent,
      notify_coparent: plan.notifyCoparent,
      split_review: plan.review,
      split_label: plan.fields?.split_label ?? null,
      other_parent_percent: plan.fields?.other_parent_percent ?? null,
      other_parent_share: plan.fields?.other_parent_share ?? null,
      amount_owed: plan.fields?.amount_owed ?? null,
    },
  };
}
