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
  logged: "Logged",
  pending: "Pending",
  submitted: "Pending",
  approved: "Approved",
  resolved: "Approved",
  disputed: "Disputed",
  paid: "Paid",
};

export const EXPENSE_STATUS_FILTERS = [
  { value: "logged", label: "Logged" },
  { value: "pending", label: "Pending" },
  { value: "approved", label: "Approved" },
  { value: "disputed", label: "Disputed" },
  { value: "paid", label: "Paid" },
] as const;

/** Stored words from before the status migration still mean Pending and Approved. */
export function canonicalExpenseStatus(status: string | null | undefined): string {
  const normalized = (status ?? "").trim().toLowerCase();
  if (normalized === "submitted") return "pending";
  if (normalized === "resolved") return "approved";
  return normalized;
}

export function expenseStatusMatches(status: string, selected: readonly string[]): boolean {
  if (selected.length === 0) return true;
  const canonical = canonicalExpenseStatus(status);
  return selected.some((value) => canonicalExpenseStatus(value) === canonical);
}

export type ExpenseTabRow = {
  amount: string | number | null;
  amount_owed?: string | number | null;
  /** Co-parent's portion of the cost. Prefer this over amount_owed, which is signed by who paid. */
  other_parent_share?: string | number | null;
  submitted_by: string;
  allocation_status?: string | null;
  status: string;
  split_label?: string | null;
  paid_amount?: string | number | null;
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

/**
 * The co-parent share a payment can settle.
 * A $0 share is a personal record and has nothing to pay.
 */
export function payableCoparentShare(
  exp: Pick<ExpenseTabRow, "other_parent_share" | "amount_owed" | "split_label">
): number | null {
  const share = coparentPortion(exp);
  if (share == null || !(share > 0)) return null;
  return Math.round(share * 100) / 100;
}

/** Dollars and cents, or null when the figure is not a number. */
export function parsePaymentAmount(value: unknown): number | null {
  if (typeof value === "string" && !value.trim()) return null;
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(parsed)) return null;
  return Math.round(parsed * 100) / 100;
}

/** True when the recorded amount covers the co-parent share. Paid means paid in full. */
export function paymentCoversShare(amount: number | null, share: number | null): boolean {
  if (amount == null || share == null || !(share > 0)) return false;
  return share - amount <= 0.001;
}

/** Why a payment amount cannot be stored, or null when it is within the co-parent share. */
export function paymentAmountError(amount: number | null, share: number | null): string | null {
  if (share == null) return "A personal expense has no co-parent share to pay.";
  if (amount == null || amount <= 0) return "Enter the amount paid.";
  if (amount - share > 0.001) return "The amount can't be more than the co-parent's share.";
  return null;
}

export function expenseIsPersonal(exp: { split_label?: string | null }): boolean {
  return (exp.split_label ?? "").trim().toLowerCase() === "personal";
}

/** Co-parent share shown in the Expenses tab "Their share" column. */
export function coparentShareForExpense(exp: ExpenseTabRow, currentUserId: string): number {
  if (expenseIsPersonal(exp)) return 0;
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
  const canonical = canonicalExpenseStatus(exp.status);
  if (!involved && (canonical === "pending" || canonical === "approved" || canonical === "logged")) {
    return "Logged";
  }
  return EXPENSE_STATUS_LABELS[exp.status] ?? EXPENSE_STATUS_LABELS[canonical] ?? exp.status;
}

/**
 * Outstanding co-parent share.
 * Paid with no paid_amount counts as paid in full. The result is never below zero.
 */
export function expenseShareRemainder(
  exp: Pick<ExpenseTabRow, "status" | "other_parent_share" | "amount_owed" | "split_label" | "paid_amount">
): number {
  const share = coparentPortion(exp);
  if (share == null || !(share > 0)) return 0;
  const paid = finiteNumber(exp.paid_amount);
  if (canonicalExpenseStatus(exp.status) === "paid" && paid == null) return 0;
  const remainder = Math.round((share - (paid ?? 0)) * 100) / 100;
  return remainder > 0 ? remainder : 0;
}

/** Amount paid and what is left, when a recorded payment does not cover the share. */
export function expensePartialPaymentText(
  exp: Pick<ExpenseTabRow, "status" | "other_parent_share" | "amount_owed" | "split_label" | "paid_amount">
): string | null {
  const paid = finiteNumber(exp.paid_amount);
  if (paid == null || !(paid > 0)) return null;
  const remainder = expenseShareRemainder(exp);
  if (!(remainder > 0)) return null;
  return `Paid ${expenseTabMoney(paid)} · ${expenseTabMoney(remainder)} left`;
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
  if (expenseIsPersonal(exp)) return "";
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

export type ExpenseBalanceFigures = {
  agreed: ExpenseTabNet;
  claimed: ExpenseTabNet;
};

function moneyFigure(owedToYou: number, youOwe: number): ExpenseTabNet {
  const owed = Math.round(owedToYou * 100) / 100;
  const owe = Math.round(youOwe * 100) / 100;
  const net = Math.round((owed - owe) * 100) / 100;
  const label =
    net > 0.01
      ? `You are owed $${net.toFixed(2)}`
      : net < -0.01
        ? `You owe $${Math.abs(net).toFixed(2)}`
        : "You are all settled";
  return { owedToYou: owed, youOwe: owe, net, label };
}

function figureForStatuses(
  expenses: ExpenseTabRow[],
  currentUserId: string,
  statuses: ReadonlySet<string>
): ExpenseTabNet {
  let owedToYou = 0;
  let youOwe = 0;
  for (const exp of expenses) {
    if (!statuses.has(canonicalExpenseStatus(exp.status))) continue;
    const remainder = expenseShareRemainder(exp);
    if (!(remainder > 0)) continue;
    if (exp.submitted_by === currentUserId) owedToYou += remainder;
    else youOwe += remainder;
  }
  return moneyFigure(owedToYou, youOwe);
}

/**
 * Two balances, from the signed-in parent's point of view.
 * Agreed outstanding is Approved rows. Claimed, awaiting response is Pending rows.
 */
export function expenseBalanceFigures(
  expenses: ExpenseTabRow[],
  currentUserId: string
): ExpenseBalanceFigures {
  return {
    agreed: figureForStatuses(expenses, currentUserId, new Set(["approved"])),
    claimed: figureForStatuses(expenses, currentUserId, new Set(["pending"])),
  };
}
