import { coparentShareInvolves } from "@/lib/expenses-share";

/** Labels and amounts shown on the Expenses tab. The report uses these same definitions. */
export const EXPENSE_CATEGORY_LABELS: Record<string, string> = {
  medical: "Medical",
  dental: "Dental",
  therapy: "Therapy",
  school: "School",
  extracurricular: "Extracurricular",
  clothing: "Clothing",
  childcare: "Childcare",
  transportation: "Transportation",
  other: "Other",
};

export const EXPENSE_STATUS_LABELS: Record<string, string> = {
  submitted: "Pending",
  disputed: "Disputed",
  resolved: "Resolved",
  paid: "Paid",
  logged: "Logged",
};

export type ExpenseTabRow = {
  amount: string | number | null;
  amount_owed?: string | number | null;
  /** Co-parent's portion of the cost. Prefer this over amount_owed, which is signed by who paid. */
  other_parent_share?: string | number | null;
  submitted_by: string;
  allocation_status?: string | null;
  status: string;
  split_label?: string | null;
};

export function formatStoredExpenseNumber(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(Number(value))) return "—";
  return `EXP-${String(Math.trunc(Number(value))).padStart(3, "0")}`;
}

export function expenseTabMoney(amount: number): string {
  return `$${amount.toFixed(2)}`;
}

export function expenseTabTotalText(amount: string | number | null | undefined): string {
  const amountNum = Number(amount);
  return Number.isNaN(amountNum) ? "—" : expenseTabMoney(amountNum);
}

function finiteNumber(value: string | number | null | undefined): number | null {
  if (value == null || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

/**
 * Co-parent's portion of the cost.
 * Older medical rows stored that portion on amount_owed and left other_parent_share at 0.
 * A filled other_parent_share, including an explicit zero with a split label, wins.
 */
export function coparentPortion(
  exp: Pick<ExpenseTabRow, "other_parent_share" | "amount_owed" | "split_label">
): number | null {
  const stored = finiteNumber(exp.other_parent_share);
  const owed = finiteNumber(exp.amount_owed);
  const label = exp.split_label?.trim() ?? "";
  const legacyUnfilled = stored === 0 && !label && owed != null && owed > 0;
  if (stored != null && !legacyUnfilled) return stored;
  return owed;
}

/** Co-parent share shown in the Expenses tab "Their share" column. */
export function coparentShareForExpense(exp: ExpenseTabRow, currentUserId: string): number {
  const amountNum = Number(exp.amount);
  const portion = coparentPortion(exp);
  const isMine = exp.submitted_by === currentUserId;
  if (portion == null) {
    if (exp.allocation_status === "NONE") return 0;
    return 0;
  }
  const theirShare = isMine ? portion : amountNum - portion;
  return Number.isFinite(theirShare) ? theirShare : 0;
}

export function displayExpenseStatus(exp: { status: string }, involved: boolean): string {
  if (
    !involved &&
    (exp.status === "submitted" || exp.status === "resolved" || exp.status === "logged")
  ) {
    return "Logged";
  }
  return EXPENSE_STATUS_LABELS[exp.status] ?? exp.status;
}

export function expenseTabStatus(exp: ExpenseTabRow, currentUserId: string): string {
  const share = coparentShareForExpense(exp, currentUserId);
  return displayExpenseStatus(exp, coparentShareInvolves(share));
}

export function expenseTabSplitText(exp: Pick<ExpenseTabRow, "allocation_status" | "split_label">): string {
  if (exp.split_label?.trim()) return exp.split_label;
  if (exp.allocation_status === "NONE") return "—";
  return "";
}

export function expenseTabTheirShareText(exp: ExpenseTabRow, currentUserId: string): string {
  if (
    exp.allocation_status === "NONE" &&
    !exp.split_label?.trim() &&
    finiteNumber(exp.other_parent_share) == null
  ) {
    return "$0.00";
  }
  const theirShare = coparentShareForExpense(exp, currentUserId);
  return Number.isNaN(theirShare) ? "—" : expenseTabMoney(theirShare);
}

export type ExpenseTabNet = {
  owedToYou: number;
  youOwe: number;
  net: number;
  label: string;
};

/** Same net as the Expenses tab: unpaid amount_owed, from the signed-in parent's point of view. */
export function expenseTabNetBalance(expenses: ExpenseTabRow[], currentUserId: string): ExpenseTabNet {
  let owedToYou = 0;
  let youOwe = 0;
  for (const exp of expenses) {
    const amountNum = Number(exp.amount);
    const owedNum = exp.amount_owed != null ? Number(exp.amount_owed) : null;
    if (
      exp.status !== "paid" &&
      !Number.isNaN(amountNum) &&
      owedNum != null &&
      !Number.isNaN(owedNum)
    ) {
      if (exp.submitted_by === currentUserId) owedToYou += owedNum;
      else youOwe += owedNum;
    }
  }
  const net = owedToYou - youOwe;
  const label =
    net > 0.01
      ? `You are owed $${net.toFixed(2)}`
      : net < -0.01
        ? `You owe $${Math.abs(net).toFixed(2)}`
        : "You are all settled";
  return { owedToYou, youOwe, net, label };
}
