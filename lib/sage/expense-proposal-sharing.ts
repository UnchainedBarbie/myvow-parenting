import {
  expenseSplitReview,
  savedExpenseShare,
  type ExpensePayer,
  type SharingResult,
} from "@/lib/expenses-sharing";
import type { Proposal } from "@/lib/sage/planner";

export type StampedExpense =
  | { kind: "proposal"; proposal: Proposal }
  | { kind: "ask"; question: string };

/** Same share math as a manual save, written onto the approval card. Does not save. */
export function stampExpenseProposal(
  proposal: Proposal,
  result: SharingResult,
  payerName?: string | null
): StampedExpense {
  const amount = typeof proposal.amount === "number" ? proposal.amount : Number.NaN;
  const payer: ExpensePayer = proposal.paid_by === "coparent" ? "coparent" : "self";
  const saved = savedExpenseShare(result, amount, payer);
  if (!saved.saveable) {
    return { kind: "ask", question: saved.clarification };
  }
  const review = expenseSplitReview({
    result,
    amount,
    payer,
    payerName: payerName ?? proposal.payer_name,
  });
  return {
    kind: "proposal",
    proposal: {
      ...proposal,
      category: proposal.category,
      requires_approval: true,
      split_label: saved.fields.split_label,
      other_parent_percent: saved.fields.other_parent_percent,
      other_parent_share: saved.fields.other_parent_share,
      amount_owed: saved.fields.amount_owed,
      split_review: review,
    },
  };
}
