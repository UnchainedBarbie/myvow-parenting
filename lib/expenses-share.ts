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

export function inferExpenseCategoryFromText(text: string): string {
  const blob = text.toLowerCase();
  if (
    /dentist|dental|orthodont|doctor|pediatric|physician|clinic|hospital|checkup|vaccine|medical|optometr|ophthalm/.test(
      blob
    )
  ) {
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

export function userAskedToNotifyCoparent(text: string): boolean {
  return (
    /\bnotify\b.{0,48}\bco-?parent\b/i.test(text) ||
    /\bco-?parent\b.{0,48}\bnotify\b/i.test(text) ||
    /\b(tell|message|text)\b.{0,32}\bco-?parent\b/i.test(text) ||
    /\blet (the )?co-?parent know\b/i.test(text) ||
    /\bshare (this |it )?with (the )?co-?parent\b/i.test(text)
  );
}
