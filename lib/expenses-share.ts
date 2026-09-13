/**
 * Co-parent involvement is driven by computed share, not by "an expense was submitted".
 * Share > $0 → they have a response to give. Share $0 → personal/documentation record.
 */

export function coparentShareInvolves(
  share: number | null | undefined
): boolean {
  const n = typeof share === "number" ? share : Number(share);
  return Number.isFinite(n) && n > 0;
}

/**
 * Workflow status for a newly saved expense.
 * notifyCoparent: user explicitly asked to involve co-parent even on a $0 share.
 */
export function expenseWorkflowStatus(opts: {
  otherParentShare: number | null | undefined;
  notifyCoparent?: boolean;
}): "submitted" | "resolved" {
  if (opts.notifyCoparent) return "submitted";
  if (coparentShareInvolves(opts.otherParentShare)) return "submitted";
  return "resolved";
}

/** Medical/dental bills are allocable shared categories — never "other"/personal. */
export const MEDICAL_EXPENSE_RE =
  /dentist|dental|orthodont|doctor|pediatric|physician|clinic|hospital|checkup|vaccine|medical|optometr|ophthalm|\bdr\.?\b/;

export function parseExpenseAmountFromText(text: string): number | undefined {
  if (!text.trim()) return undefined;
  const dollar = text.match(
    /\$\s*(\d{1,3}(?:,\d{3})*(?:\.\d{1,2})?|\d+(?:\.\d{1,2})?)/
  );
  if (dollar) {
    const n = parseFloat(dollar[1].replace(/,/g, ""));
    if (Number.isFinite(n) && n > 0) return n;
  }
  const words = text.match(
    /\b(\d{1,3}(?:,\d{3})*(?:\.\d{1,2})?)\s*(?:dollars?|usd)\b/i
  );
  if (words) {
    const n = parseFloat(words[1].replace(/,/g, ""));
    if (Number.isFinite(n) && n > 0) return n;
  }
  return undefined;
}

const EXPENSE_FORM_CATEGORIES = [
  "other",
  "medical",
  "school",
  "therapy",
  "extracurricular",
  "clothing",
  "transportation",
  "childcare",
  "dental",
] as const;

/** Map runClassify / receipt-extract category strings onto ExpenseForm values. */
export function mapExpenseCategoryFromClassify(
  raw: string | null | undefined
): string {
  if (!raw || !raw.trim()) return "other";
  const lower = raw.trim().toLowerCase();
  if (lower === "education") return "school";
  if (lower === "activities" || lower === "activity") return "extracurricular";
  if (lower === "food" || lower === "housing") return "other";
  if ((EXPENSE_FORM_CATEGORIES as readonly string[]).includes(lower)) {
    return lower;
  }
  return "other";
}

export function inferExpenseCategoryFromText(
  text: string,
  domain?: string | null
): string {
  const blob = text.toLowerCase();
  const domainNorm = (domain ?? "").toLowerCase();
  if (MEDICAL_EXPENSE_RE.test(blob) || domainNorm === "medical") {
    return "medical";
  }
  if (/school|teacher|tuition|classroom|parent-?teacher/.test(blob)) return "school";
  if (/therap|counsel/.test(blob)) return "therapy";
  if (
    /concert|choir|music|recital|soccer|practice|dance|\bsports?\b|\bgame\b|extracurricular/.test(
      blob
    )
  ) {
    return "extracurricular";
  }
  if (/cloth|shoe|apparel/.test(blob)) return "clothing";
  if (/childcare|daycare|babysit/.test(blob)) return "childcare";
  if (/\buber\b|gas|mileage|transport/.test(blob)) return "transportation";
  return "other";
}

/** True when the parent is logging a bill/cost (vs a calendar-only medical appointment). */
export function looksLikeExpenseCommand(text: string): boolean {
  const blob = text.toLowerCase();
  if (/\b(expense|receipt|reimburse|ledger|invoice)\b/.test(blob)) return true;
  const amount = parseExpenseAmountFromText(text);
  const medical = MEDICAL_EXPENSE_RE.test(blob);
  if (amount != null && medical) return true;
  if (amount != null && /\b(log|paid|pay|cost|bill|charge)\b/.test(blob)) return true;
  if (/\b(calendar|schedule)\b/.test(blob) && amount == null) return false;
  return /\b(log|record|submit)\b/.test(blob) && medical;
}

export function userAskedToNotifyCoparent(text: string): boolean {
  return (
    /\bnotify\b.{0,48}\bco-?parent\b/i.test(text) ||
    /\bco-?parent\b.{0,48}\bnotify\b/i.test(text) ||
    /\b(tell|message|text)\b.{0,32}\bco-?parent\b/i.test(text) ||
    /\blet (the )?co-?parent know\b/i.test(text) ||
    /\bshare (this |it )?with (the )?co-?parent\b/i.test(text)
  );
}
