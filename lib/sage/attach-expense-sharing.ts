import { computeAllocationFromParentingPlan } from "@/lib/expenses-allocation";
import { stampExpenseProposal } from "@/lib/sage/expense-proposal-sharing";
import type { Plan, Proposal } from "@/lib/sage/planner";

/**
 * Apply the same sharing calculation a manual save uses, before the parent approves.
 * A missing rule becomes a question. Nothing is written to the expenses table.
 */
export async function attachExpenseSharing(input: {
  caseId: string;
  proposals: Proposal[];
  childId: string | null;
  reply: string;
  fallbackAmount?: number | null;
  fallbackCategory?: string | null;
}): Promise<{ proposals: Proposal[]; reply: string; status: Plan["status"] | null }> {
  const next: Proposal[] = [];
  const questions: string[] = [];
  let changed = false;

  for (const proposal of input.proposals) {
    if (proposal.type !== "log_expense") {
      next.push(proposal);
      continue;
    }
    const amount =
      typeof proposal.amount === "number" && proposal.amount > 0
        ? proposal.amount
        : typeof input.fallbackAmount === "number" && input.fallbackAmount > 0
          ? input.fallbackAmount
          : null;
    const category = proposal.category?.trim() || input.fallbackCategory?.trim() || "";
    if (amount == null || !category) {
      changed = true;
      const question = amount == null
        ? "What was the amount of this expense?"
        : "Which category should I use so I can apply the sharing rule?";
      questions.push(question);
      next.push({
        type: "ask_clarification",
        draft: question,
        depends_on: null,
        requires_approval: true,
        audience: "parent",
      });
      continue;
    }

    const allocation = await computeAllocationFromParentingPlan({
      caseId: input.caseId,
      amount,
      category,
      childId: input.childId,
    });
    const stamped = stampExpenseProposal(
      { ...proposal, amount, category },
      allocation,
      proposal.payer_name
    );
    changed = true;
    if (stamped.kind === "ask") {
      questions.push(stamped.question);
      next.push({
        type: "ask_clarification",
        draft: stamped.question,
        depends_on: null,
        requires_approval: true,
        audience: "parent",
      });
      continue;
    }
    next.push(stamped.proposal);
    if (stamped.proposal.split_review) questions.push(stamped.proposal.split_review);
  }

  if (!changed) {
    return { proposals: input.proposals, reply: input.reply, status: null };
  }

  const onlyQuestions = next.length > 0 && next.every((proposal) => proposal.type === "ask_clarification");
  const reply = mergeReply(input.reply, questions, onlyQuestions);
  return {
    proposals: next,
    reply,
    status: onlyQuestions ? "awaiting_clarification" : null,
  };
}

function mergeReply(prior: string, notes: string[], replacedExpense: boolean): string {
  const unique = notes.map((note) => note.trim()).filter(Boolean);
  if (unique.length === 0) return prior;
  if (replacedExpense) {
    if (/what time/i.test(prior)) {
      const time = prior.split(/I can also log/i)[0].trim();
      return `${time} ${unique.join(" ")}`.trim();
    }
    return unique.join(" ");
  }
  const additions = unique.filter((note) => !prior.includes(note));
  if (additions.length === 0) return prior;
  return `${prior} ${additions.join(" ")}`.trim();
}
