import {
  EXPENSE_CATEGORY_LABELS,
  expenseTabMoney,
  expenseTabNetBalance,
  expenseTabSplitText,
  expenseTabStatus,
  expenseTabTheirShareText,
  expenseTabTotalText,
  formatStoredExpenseNumber,
  type ExpenseTabRow,
} from "@/lib/expenses-tab";
import { formatDateSpan, zonedDayEndMs, zonedDayStartMs } from "@/lib/record/record-filters";
import { formatDocumentNumber } from "@/lib/documents-tab";
import { supportingEvidenceCell } from "@/lib/reports/evidence-refs";

export type ExpenseParty = {
  userId: string | null;
  name: string;
};

export type ExpenseReportSource = {
  id: string;
  expenseNumber: number | null;
  createdAt: string;
  incurredDate: string | null;
  description: string;
  category: string;
  categoryDescription: string | null;
  amount: string | number | null;
  submittedBy: string;
  amountOwed: string | number | null;
  otherParentShare: string | number | null;
  otherParentPercent: string | number | null;
  splitLabel: string | null;
  allocationStatus: string | null;
  status: string;
  disputeReason: string | null;
  approvedBy: string | null;
  approvedAt: string | null;
  resolvedAt: string | null;
  paidAt: string | null;
  paymentMethod: string | null;
  paymentReference: string | null;
  paymentNotes: string | null;
  receiptName: string | null;
  receiptDocumentNumber: number | null;
  receiptFileId?: string | null;
  receiptUnavailable?: boolean;
  childName: string | null;
};

export type ExpenseReportOptions = {
  ledger: boolean;
  payments: boolean;
  disputes: boolean;
  netBalance: boolean;
  receiptsZip: boolean;
};

export type ExpenseFact = { label: string; value: string };

export type ExpenseTableBlock = {
  kind: "table";
  title: string;
  intro?: string;
  headers: string[];
  widths?: number[];
  rows: string[][];
  empty: string;
};

export type ExpenseLinesBlock = {
  kind: "lines";
  title: string;
  lines: string[];
};

export type ExpenseReportDocument = {
  facts: ExpenseFact[];
  blocks: Array<ExpenseLinesBlock | ExpenseTableBlock>;
  completeness: string;
  verificationExplanation: string;
};

export type PreparedExpenseReport = {
  document: ExpenseReportDocument;
  verificationPayload: string;
  includedCount: number;
};

const CATEGORY_LABELS: Record<string, string> = {
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

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export function formatExpenseCurrency(amount: number): string {
  const negative = amount < 0;
  const [whole, fraction] = Math.abs(amount).toFixed(2).split(".");
  const withCommas = Number(whole).toLocaleString("en-US");
  return `${negative ? "-" : ""}$${withCommas}.${fraction}`;
}

export function formatExpenseNumber(value: number | null): string {
  if (value == null || !Number.isFinite(value)) return "";
  return `EXP-${String(Math.trunc(value)).padStart(3, "0")}`;
}

export function expenseStatusLabel(status: string, share: number | null): string {
  const normalized = status.trim().toLowerCase();
  if (
    share === 0 &&
    (normalized === "submitted" || normalized === "resolved" || normalized === "logged")
  ) {
    return "Logged";
  }
  switch (normalized) {
    case "submitted":
      return "Pending";
    case "disputed":
      return "Disputed";
    case "resolved":
      return "Resolved";
    case "paid":
      return "Paid";
    case "approved":
      return "Approved";
    case "logged":
      return "Logged";
    default:
      return status.trim() || "Not recorded";
  }
}

function money(value: string | number | null | undefined): number | null {
  if (value == null || value === "") return null;
  const numeric = typeof value === "number" ? value : Number(String(value).replace(/,/g, ""));
  if (!Number.isFinite(numeric)) return null;
  return Math.round(numeric * 100) / 100;
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

function cleanDate(value: string | null | undefined): string | null {
  const trimmed = value?.trim() ?? "";
  return DATE_RE.test(trimmed) ? trimmed : null;
}

export function expenseEnteredInRange(
  createdAt: string,
  start: string | null,
  end: string | null,
  timeZone: string
): boolean {
  const entered = Date.parse(createdAt);
  if (!Number.isFinite(entered)) return false;
  const from = cleanDate(start);
  const to = cleanDate(end);
  if (from && entered < zonedDayStartMs(from, timeZone)) return false;
  if (to && entered > zonedDayEndMs(to, timeZone)) return false;
  return true;
}

function formatWhen(iso: string, timeZone: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return new Intl.DateTimeFormat("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short",
    timeZone,
  }).format(date);
}

function formatCalendarDay(isoDate: string): string {
  const [year, month, day] = isoDate.split("-").map(Number);
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(Date.UTC(year, month - 1, day)));
}

function formatEnteredDay(iso: string, timeZone: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "Not recorded";
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone,
  }).format(date);
}

function percentLabel(value: number): string {
  const rounded = round2(value);
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(2);
}

type ShareInfo = {
  amount: number | null;
  share: number | null;
  remainder: number | null;
  inconsistent: boolean;
};

function shareInfo(expense: ExpenseReportSource): ShareInfo {
  const amount = money(expense.amount);
  const share = money(expense.otherParentShare) ?? money(expense.amountOwed);
  if (amount == null || share == null) {
    return { amount, share, remainder: null, inconsistent: false };
  }
  if (share - amount > 0.001) {
    return { amount, share, remainder: null, inconsistent: true };
  }
  return { amount, share, remainder: round2(amount - share), inconsistent: false };
}

function statusOf(expense: ExpenseReportSource): string {
  return expense.status.trim().toLowerCase();
}

function isPaid(expense: ExpenseReportSource): boolean {
  return statusOf(expense) === "paid";
}

function isAccepted(expense: ExpenseReportSource): boolean {
  const status = statusOf(expense);
  return status === "resolved" || status === "approved";
}

function hasPaymentDetails(expense: ExpenseReportSource): boolean {
  return Boolean(
    expense.paidAt?.trim() ||
      expense.paymentMethod?.trim() ||
      expense.paymentReference?.trim() ||
      expense.paymentNotes?.trim()
  );
}

function hasDisputeRecord(expense: ExpenseReportSource): boolean {
  return statusOf(expense) === "disputed" || Boolean(expense.disputeReason?.trim() || expense.resolvedAt?.trim());
}

type NamedParent = { key: string; name: string };

function parentKey(userId: string | null, name: string): string {
  return userId ?? `name:${name}`;
}

function namedParents(parents: ExpenseParty[]): NamedParent[] {
  const seen = new Set<string>();
  const list: NamedParent[] = [];
  for (const parent of parents) {
    const name = parent.name.trim();
    if (!name) continue;
    const key = parentKey(parent.userId, name);
    if (seen.has(key)) continue;
    seen.add(key);
    list.push({ key, name });
  }
  return list;
}

function parentByUserId(parents: NamedParent[], source: ExpenseParty[]): Map<string, NamedParent> {
  const byId = new Map<string, NamedParent>();
  for (const parent of source) {
    if (!parent.userId) continue;
    const named = parents.find((item) => item.key === parent.userId);
    if (named) byId.set(parent.userId, named);
  }
  return byId;
}

function otherParent(
  submitterId: string,
  parents: NamedParent[],
  byUserId: Map<string, NamedParent>
): NamedParent | null {
  const others = parents.filter((parent) => parent.key !== submitterId && byUserId.has(parent.key));
  const connected = [...byUserId.values()].filter((parent) => parent.key !== submitterId);
  if (connected.length === 1) return connected[0];
  if (others.length === 1) return others[0];
  return null;
}

function expenseIdentity(expense: ExpenseReportSource): string {
  const label = formatStoredExpenseNumber(expense.expenseNumber);
  return label === "—" ? expense.id : label;
}

function toTabRow(expense: ExpenseReportSource): ExpenseTabRow {
  return {
    amount: expense.amount,
    amount_owed: expense.amountOwed,
    submitted_by: expense.submittedBy,
    allocation_status: expense.allocationStatus,
    status: expense.status,
    split_label: expense.splitLabel,
  };
}

function ledgerDayKey(expense: ExpenseReportSource, timeZone: string): string {
  const incurred = cleanDate(expense.incurredDate);
  if (incurred) return incurred;
  const date = new Date(expense.createdAt);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat("en-CA", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    timeZone,
  }).format(date);
}

function tabDateLabel(expense: ExpenseReportSource, timeZone: string): string {
  const incurred = cleanDate(expense.incurredDate);
  if (incurred) {
    const [year, month, day] = incurred.split("-").map(Number);
    return new Intl.DateTimeFormat("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
      timeZone: "UTC",
    }).format(new Date(Date.UTC(year, month - 1, day)));
  }
  const date = new Date(expense.createdAt);
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone,
  }).format(date);
}

function categoryLabel(expense: ExpenseReportSource): string {
  const base = CATEGORY_LABELS[expense.category] ?? (expense.category.trim() || "Not recorded");
  const note = expense.categoryDescription?.trim();
  return note ? `${base} (${note})` : base;
}

function dateCell(expense: ExpenseReportSource, timeZone: string): string {
  const incurred = cleanDate(expense.incurredDate);
  const entered = formatEnteredDay(expense.createdAt, timeZone);
  if (incurred) return `${formatCalendarDay(incurred)}\nEntered ${entered}`;
  return `Entered ${entered}\nIncurred date not recorded`;
}

function allocationCell(
  expense: ExpenseReportSource,
  info: ShareInfo,
  submitter: string,
  counterparty: string | null
): string {
  const lines = [`Submitted by ${submitter}`];
  if (info.inconsistent) {
    lines.push(
      `Recorded co-parent share ${formatExpenseCurrency(info.share ?? 0)} exceeds the expense total. Remaining balance is not calculated.`
    );
  } else if (info.share == null) {
    lines.push("Allocated share not recorded. A split was not assumed.");
  } else {
    const who = counterparty ?? "the parent who did not submit this expense";
    lines.push(`Co-parent share: ${formatExpenseCurrency(info.share)} (${who})`);
    if (info.remainder != null) {
      lines.push(`Submitter remainder: ${formatExpenseCurrency(info.remainder)}`);
    }
    const percent = money(expense.otherParentPercent);
    if (percent != null) lines.push(`Recorded co-parent percent: ${percentLabel(percent)}%`);
    else if (expense.splitLabel?.trim()) lines.push(`Recorded split label: ${expense.splitLabel.trim()}`);
  }
  if (expense.allocationStatus?.trim().toUpperCase() === "MANUAL_REQUIRED" && info.share == null) {
    lines.push("Manual allocation is required and has not been recorded.");
  }
  if (isPaid(expense) && info.share != null && !info.inconsistent) {
    lines.push(`Marked paid: ${formatExpenseCurrency(info.share)}`);
    lines.push("Remaining allocated share: $0.00");
  } else if (info.share != null && !info.inconsistent && info.share > 0 && !isPaid(expense)) {
    lines.push("Amount paid: not recorded");
    lines.push(`Remaining allocated share: ${formatExpenseCurrency(info.share)}`);
  } else if (!isPaid(expense)) {
    lines.push("Amount paid: not recorded");
    lines.push("Remaining balance: not determinable");
  }
  const receipt = receiptReference(expense);
  if (receipt) lines.push(`Receipt: ${receipt}`);
  return lines.join("\n");
}

function receiptReference(expense: ExpenseReportSource): string | null {
  const name = expense.receiptName?.trim();
  if (!name && expense.receiptDocumentNumber == null) return null;
  const label = name || "Receipt on file";
  if (expense.receiptDocumentNumber == null) return label;
  return `${label} (DOC-${String(expense.receiptDocumentNumber).padStart(3, "0")})`;
}

type ParentTotals = {
  parent: NamedParent;
  coparentShare: number;
  coparentCount: number;
  remainder: number;
  remainderCount: number;
  unallocatedSubmitted: number;
  markedPaid: number;
  markedPaidCount: number;
  outstandingOwedToThem: number;
  outstandingOwedToThemCount: number;
  outstandingTheyOwe: number;
  outstandingTheyOweCount: number;
};

function emptyTotals(parent: NamedParent): ParentTotals {
  return {
    parent,
    coparentShare: 0,
    coparentCount: 0,
    remainder: 0,
    remainderCount: 0,
    unallocatedSubmitted: 0,
    markedPaid: 0,
    markedPaidCount: 0,
    outstandingOwedToThem: 0,
    outstandingOwedToThemCount: 0,
    outstandingTheyOwe: 0,
    outstandingTheyOweCount: 0,
  };
}

function add(totals: ParentTotals, field: "coparentShare" | "remainder" | "markedPaid" | "outstandingOwedToThem" | "outstandingTheyOwe", amount: number) {
  totals[field] = round2(totals[field] + amount);
}

export function sortExpensesForLedger(
  expenses: ExpenseReportSource[],
  timeZone: string
): ExpenseReportSource[] {
  return [...expenses].sort((a, b) => {
    const aDay = ledgerDayKey(a, timeZone);
    const bDay = ledgerDayKey(b, timeZone);
    if (aDay !== bDay) return aDay < bDay ? 1 : -1;
    if (a.createdAt !== b.createdAt) return a.createdAt < b.createdAt ? 1 : -1;
    return a.id < b.id ? 1 : -1;
  });
}

export function prepareExpenseReport(input: {
  expenses: ExpenseReportSource[];
  parents: ExpenseParty[];
  caseLabel: string;
  timeZone: string;
  dateStart: string | null;
  dateEnd: string | null;
  generatedAt: Date;
  viewerId: string;
  viewerName: string;
  options: ExpenseReportOptions;
  receiptLines: string[];
  evidenceLabels?: Map<string, string> | null;
}): PreparedExpenseReport {
  const parents = namedParents(input.parents);
  const byUserId = parentByUserId(parents, input.parents);
  const from = cleanDate(input.dateStart);
  const to = cleanDate(input.dateEnd);
  const filtered = Boolean(from || to);
  const included = input.expenses.filter((expense) =>
    expenseEnteredInRange(expense.createdAt, from, to, input.timeZone)
  );
  const outside = input.expenses.length - included.length;
  const totals = new Map<string, ParentTotals>();
  for (const parent of parents) totals.set(parent.key, emptyTotals(parent));

  let totalAmount = 0;
  let totalKnown = 0;
  let amountMissing = 0;
  let disputedAmount = 0;
  let disputedWithShare = 0;
  let disputedWithoutShare = 0;
  let pendingAmount = 0;
  let pendingCount = 0;
  let unallocatedCount = 0;
  let unallocatedAmount = 0;
  let inconsistentCount = 0;
  let unattributedOutstanding = 0;
  const statusCounts = new Map<string, number>();

  const sorted = sortExpensesForLedger(included, input.timeZone);

  const ledgerRows: string[][] = [];
  const paymentRows: string[][] = [];
  const disputeRows: string[][] = [];
  const payload: string[] = [];

  for (const expense of sorted) {
    const info = shareInfo(expense);
    const label = expenseStatusLabel(expense.status, info.share);
    statusCounts.set(label, (statusCounts.get(label) ?? 0) + 1);
    if (info.amount == null) amountMissing += 1;
    else {
      totalAmount = round2(totalAmount + info.amount);
      totalKnown += 1;
    }
    if (info.inconsistent) inconsistentCount += 1;
    if (info.share == null) {
      unallocatedCount += 1;
      if (info.amount != null) unallocatedAmount = round2(unallocatedAmount + info.amount);
    }

    const submitter = byUserId.get(expense.submittedBy);
    const submitterName = submitter?.name ?? "Parent not on this case";
    const counterparty = otherParent(expense.submittedBy, parents, byUserId);
    const submitterTotals = submitter ? totals.get(submitter.key) : undefined;
    const counterTotals = counterparty ? totals.get(counterparty.key) : undefined;

    if (submitterTotals && info.remainder != null && !info.inconsistent) {
      add(submitterTotals, "remainder", info.remainder);
      submitterTotals.remainderCount += 1;
    }
    if (submitterTotals && info.share == null) submitterTotals.unallocatedSubmitted += 1;
    if (counterTotals && info.share != null && !info.inconsistent) {
      add(counterTotals, "coparentShare", info.share);
      counterTotals.coparentCount += 1;
    }
    if (
      counterTotals &&
      isPaid(expense) &&
      info.share != null &&
      !info.inconsistent
    ) {
      add(counterTotals, "markedPaid", info.share);
      counterTotals.markedPaidCount += 1;
    }
    const acceptedUnpaid =
      isAccepted(expense) && !isPaid(expense) && info.share != null && info.share > 0 && !info.inconsistent;
    if (acceptedUnpaid && counterTotals && submitterTotals && info.share != null) {
      add(counterTotals, "outstandingTheyOwe", info.share);
      counterTotals.outstandingTheyOweCount += 1;
      add(submitterTotals, "outstandingOwedToThem", info.share);
      submitterTotals.outstandingOwedToThemCount += 1;
    } else if (acceptedUnpaid) {
      unattributedOutstanding += 1;
    }
    if (statusOf(expense) === "disputed") {
      if (info.share != null && !info.inconsistent) {
        disputedAmount = round2(disputedAmount + info.share);
        disputedWithShare += 1;
      } else disputedWithoutShare += 1;
    }
    if (statusOf(expense) === "submitted" && info.share != null && info.share > 0 && !info.inconsistent) {
      pendingAmount = round2(pendingAmount + info.share);
      pendingCount += 1;
    }

    const id = expenseIdentity(expense);
    const tabRow = toTabRow(expense);
    const categoryName = EXPENSE_CATEGORY_LABELS[expense.category] ?? (expense.category.trim() || "");
    const otherNote =
      expense.category === "other" ? expense.categoryDescription?.trim() ?? "" : "";
    const subtitle = [categoryName, expense.receiptName?.trim() || ""].filter(Boolean).join(" • ");
    const documentLabel =
      expense.receiptFileId && formatDocumentNumber(expense.receiptDocumentNumber) !== "—"
        ? formatDocumentNumber(expense.receiptDocumentNumber)
        : null;
    const includePages = input.evidenceLabels != null && input.options.receiptsZip;
    const planned = includePages ? input.evidenceLabels?.get(id) ?? null : null;
    const evidence =
      planned ??
      supportingEvidenceCell({
        linked: Boolean(expense.receiptFileId),
        documentLabel,
        includeFiles: includePages,
        pageLabel: null,
        unavailable: Boolean(expense.receiptUnavailable),
      });
    ledgerRows.push([
      id,
      [expense.description.trim() || "—", subtitle].filter(Boolean).join("\n"),
      [categoryName || "—", otherNote].filter(Boolean).join("\n"),
      expense.childName?.trim() || "—",
      dateCell(expense, input.timeZone),
      submitterName,
      expenseTabTotalText(expense.amount),
      expenseTabSplitText(tabRow),
      expenseTabTheirShareText(tabRow, input.viewerId),
      expenseTabStatus(tabRow, input.viewerId),
      evidence,
    ]);

    if (isPaid(expense) || hasPaymentDetails(expense)) {
      const detail = [
        expense.paymentMethod?.trim() ? `Method: ${expense.paymentMethod.trim()}` : "",
        expense.paymentReference?.trim() ? `Reference: ${expense.paymentReference.trim()}` : "",
        expense.paymentNotes?.trim() ? `Notes: ${expense.paymentNotes.trim()}` : "",
      ]
        .filter(Boolean)
        .join("\n");
      const amountText = isPaid(expense)
        ? info.share == null || info.inconsistent
          ? "Marked paid. Amount not stored."
          : `Allocated share marked paid: ${formatExpenseCurrency(info.share)}`
        : "Payment details recorded. Status is not Paid, so this is not treated as payment in full. A partial amount is not stored.";
      const recordedBy = expense.approvedBy
        ? byUserId.get(expense.approvedBy)?.name ?? "Parent not on this case"
        : "Not recorded";
      paymentRows.push([
        expense.paidAt?.trim() ? formatWhen(expense.paidAt, input.timeZone) : "Not recorded",
        `${id}\n${expense.description.trim() || "No description"}`,
        amountText,
        isPaid(expense) ? counterparty?.name ?? "Not recorded" : "Not recorded",
        recordedBy,
        detail || "No method, reference, or note recorded",
      ]);
    }

    if (hasDisputeRecord(expense)) {
      const resolution = expense.resolvedAt?.trim()
        ? `Resolved ${formatWhen(expense.resolvedAt, input.timeZone)}`
        : isAccepted(expense) || isPaid(expense)
          ? `Marked ${label.toLowerCase()}${
              expense.approvedAt?.trim() ? ` ${formatWhen(expense.approvedAt, input.timeZone)}` : ""
            }${
              expense.approvedBy
                ? ` by ${byUserId.get(expense.approvedBy)?.name ?? "a parent not on this case"}`
                : ""
            }. A separate resolution statement is not stored.`
          : "No resolution is recorded. A separate response is not stored.";
      disputeRows.push([
        `${id}\n${expense.description.trim() || "No description"}`,
        label,
        expense.disputeReason?.trim() || "No dispute reason was recorded.",
        resolution,
      ]);
    }

    payload.push(
      [
        expense.id,
        expense.expenseNumber ?? "",
        expense.createdAt,
        expense.incurredDate ?? "",
        info.amount ?? "",
        info.share ?? "",
        expense.status,
        expense.submittedBy,
      ].join("~")
    );
  }

  const duplicates = duplicateNotes(sorted, input.timeZone);
  const dateLabel = !filtered
    ? "All entered dates"
    : from && to
      ? formatDateSpan(from <= to ? from : to, from <= to ? to : from)
      : from
        ? `Entered on or after ${formatDateSpan(from, from)}`
        : `Entered on or before ${formatDateSpan(to as string, to as string)}`;
  const generatedLabel = new Intl.DateTimeFormat("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short",
    timeZone: input.timeZone,
  }).format(input.generatedAt);
  const sectionNames: string[] = [];
  if (input.options.netBalance) sectionNames.push("Net balance");
  if (input.options.ledger) sectionNames.push("All expenses");
  if (input.options.payments) sectionNames.push("Payment history");
  if (input.options.disputes) sectionNames.push("Dispute history");
  if (input.options.receiptsZip) sectionNames.push("Receipt files");

  const blocks: ExpenseReportDocument["blocks"] = [];
  if (input.options.netBalance) {
    const viewer = input.viewerName.trim() || "the parent who generated this report";
    const overall = expenseTabNetBalance(input.expenses.map(toTabRow), input.viewerId);
    const period = expenseTabNetBalance(included.map(toTabRow), input.viewerId);
    const periodNote = filtered
      ? `Calculated only from expenses entered in ${dateLabel}. This is not the current overall balance.`
      : "No date filter was applied, so this period balance is the same as the current overall balance.";
    blocks.push({
      kind: "lines",
      title: "Net balance",
      lines: [
        `Shown for ${viewer}, using the same balance as that parent's Expenses tab. Paid expenses are excluded.`,
        "Current overall balance. Every expense currently on the Expenses tab, including records outside this report's dates.",
        `They owe you: ${expenseTabMoney(overall.owedToYou)}`,
        `You owe them: ${expenseTabMoney(overall.youOwe)}`,
        `Net: ${overall.label}`,
        "Selected reporting period.",
        periodNote,
        `They owe you: ${expenseTabMoney(period.owedToYou)}`,
        `You owe them: ${expenseTabMoney(period.youOwe)}`,
        `Net: ${period.label}`,
      ],
    });
  }
  if (duplicates.length > 0) {
    blocks.push({
      kind: "lines",
      title: "Possible duplicate records",
      lines: [
        "These records share a description, amount, and date. They are listed separately and have not been combined or removed.",
        ...duplicates,
      ],
    });
  }
  if (input.options.ledger) {
    blocks.push({
      kind: "table",
      title: "All expenses",
      intro: `Columns follow the Expenses tab for ${input.viewerName.trim() || "the parent who generated this report"}. Submitted by is the parent who entered the expense. Their share is that parent's co-parent share, which is separate from who paid. Dates show the incurred date and the entered date. The report date filter uses the entered date.`,
      headers: [
        "Expense ID",
        "Description",
        "Category",
        "Child",
        "Date",
        "Submitted by",
        "Total",
        "Split",
        "Their share",
        "Status",
        "Supporting evidence",
      ],
      widths: [16, 36, 20, 16, 28, 28, 16, 14, 18, 16, 47.4],
      rows: ledgerRows,
      empty: "No expenses were entered in the selected dates.",
    });
  }
  if (input.options.payments) {
    blocks.push({
      kind: "table",
      title: "Payment history",
      intro:
        "A reimbursement recipient is not stored. The parent named here is the parent whose recorded share was marked paid, when that parent can be identified from the case.",
      headers: ["Date", "Expense", "Amount", "Share marked paid", "Recorded by", "Details"],
      widths: [32, 46, 50, 38, 36, 53.4],
      rows: paymentRows,
      empty: "No payment dates, methods, references, notes, or Paid status are stored for the included expenses.",
    });
  }
  if (input.options.disputes) {
    blocks.push({
      kind: "table",
      title: "Dispute history",
      intro: "Only recorded dispute reasons and resolution times are shown.",
      headers: ["Expense", "Status", "Dispute reason", "Resolution"],
      widths: [46, 28, 90, 91.4],
      rows: disputeRows,
      empty: "No dispute reasons, disputed statuses, or resolution times are stored for the included expenses.",
    });
  }
  if (input.options.receiptsZip) {
    const lines =
      input.receiptLines.length > 0
        ? [
            "Receipts follow this report in the same order as the expense table. Each file is introduced with its expense number. A receipt linked to more than one expense is included once, with every expense number listed.",
            ...input.receiptLines,
          ]
        : ["No receipt files are linked to the expenses in this report."];
    blocks.push({ kind: "lines", title: "Receipt files", lines });
  }

  const outsideSentence =
    outside === 0
      ? "No other expense records in this case fall outside those dates."
      : `${outside} other expense record${outside === 1 ? "" : "s"} in this case ${outside === 1 ? "falls" : "fall"} outside those dates and ${outside === 1 ? "remains" : "remain"} in the case.`;
  const completeness = filtered
    ? `This is a filtered expense report. ${included.length} expense record${included.length === 1 ? " is" : "s are"} included. ${outsideSentence}`
    : `This report includes all ${included.length} expense record${included.length === 1 ? "" : "s"} in this case.`;

  return {
    includedCount: included.length,
    verificationPayload: payload.join("|"),
    document: {
      facts: [
        { label: "Case", value: input.caseLabel || "Not recorded" },
        {
          label: "Parties",
          value: parents.length > 0 ? parents.map((parent) => parent.name).join("; ") : "Not recorded",
        },
        { label: "Date range", value: `${dateLabel}. Expenses are included by the date they were entered, not the incurred date.` },
        { label: "Generated", value: generatedLabel },
        { label: "Sections", value: sectionNames.join("; ") },
      ],
      blocks,
      completeness,
      verificationExplanation:
        "This SHA-256 hash covers the included expense identifiers, numbers, entered and incurred dates, amounts, recorded shares, statuses, and submitting parents. It does not cover receipt file bytes. It is not an independent certification. Unavailable receipts stay listed in Supporting evidence.",
    },
  };
}

function netLines(parents: NamedParent[], totals: Map<string, ParentTotals>): string[] {
  const rows = parents.map((parent) => totals.get(parent.key)).filter((row): row is ParentTotals => Boolean(row));
  const any = rows.some((row) => row.outstandingOwedToThem > 0 || row.outstandingTheyOwe > 0);
  if (!any) {
    return [
      "No accepted, unpaid allocated shares are recorded, so there is no net balance to calculate.",
      "Pending and disputed expenses are excluded.",
    ];
  }
  const lines = rows.map(
    (row) =>
      `${row.parent.name} is owed ${formatExpenseCurrency(row.outstandingOwedToThem)} and owes ${formatExpenseCurrency(row.outstandingTheyOwe)} in accepted, unpaid allocated shares.`
  );
  if (parents.length === 2) {
    const [first, second] = rows;
    if (first && second) {
      const net = round2(first.outstandingOwedToThem - first.outstandingTheyOwe);
      if (net > 0) {
        lines.push(
          `Between these parents, ${first.parent.name} is owed ${formatExpenseCurrency(net)} more than ${second.parent.name} in accepted, unpaid allocated shares.`
        );
      } else if (net < 0) {
        lines.push(
          `Between these parents, ${second.parent.name} is owed ${formatExpenseCurrency(Math.abs(net))} more than ${first.parent.name} in accepted, unpaid allocated shares.`
        );
      } else {
        lines.push("Between these parents, accepted unpaid allocated shares are even.");
      }
    }
  }
  lines.push("This net uses recorded accepted shares only. It is not a judgment or a calculation of unallocated expenses.");
  return lines;
}

function duplicateNotes(expenses: ExpenseReportSource[], timeZone: string): string[] {
  const groups = new Map<string, ExpenseReportSource[]>();
  for (const expense of expenses) {
    const info = shareInfo(expense);
    const day = cleanDate(expense.incurredDate) ?? formatEnteredDay(expense.createdAt, timeZone);
    const key = `${expense.description.trim().toLowerCase()}|${info.amount ?? "na"}|${day}`;
    const list = groups.get(key) ?? [];
    list.push(expense);
    groups.set(key, list);
  }
  const notes: string[] = [];
  for (const group of groups.values()) {
    if (group.length < 2) continue;
    notes.push(group.map((expense) => expenseIdentity(expense)).join(", "));
  }
  return notes;
}

export function buildExpenseReportCsv(document: ExpenseReportDocument): string {
  const lines: string[] = [];
  const push = (cells: string[]) => {
    lines.push(cells.map(csvCell).join(","));
  };
  push(["Section", "Field", "Value"]);
  for (const fact of document.facts) push(["Report", fact.label, fact.value]);
  push(["Report", "Completeness", document.completeness]);
  for (const block of document.blocks) {
    if (block.kind === "lines") {
      block.lines.forEach((line, index) => push([block.title, String(index + 1), line]));
      continue;
    }
    if (block.intro) push([block.title, "Note", block.intro]);
    if (block.rows.length === 0) {
      push([block.title, "Records", block.empty]);
      continue;
    }
    push([block.title, ...block.headers]);
    for (const row of block.rows) push(["", ...row]);
  }
  return lines.join("\r\n");
}

function csvCell(value: string): string {
  const text = value.replace(/\r?\n/g, " | ").replace(/"/g, '""');
  return /[",]/.test(text) ? `"${text}"` : text;
}
