/** Normalize planner / persisted proposal type strings for comparisons. */
export function normalizeProposalType(type?: string | null): string {
  return (type ?? "").trim().toLowerCase().replace(/[\s-]+/g, "_");
}

export function isCalendarUpdateProposal(type?: string | null): boolean {
  const t = normalizeProposalType(type);
  return t === "calendar_update" || t === "calendar";
}

export function isLogExpenseProposal(type?: string | null): boolean {
  const t = normalizeProposalType(type);
  return t === "log_expense" || t === "expense" || t === "logexpense";
}

export function isLogDocumentProposal(type?: string | null): boolean {
  const t = normalizeProposalType(type);
  return t === "log_document" || t === "file_document";
}

/** Sage is asking the parent for a missing detail. That is chat, not an approval. */
export function isParentClarification(proposal: {
  type?: string | null;
  audience?: string | null;
}): boolean {
  return normalizeProposalType(proposal.type) === "ask_clarification" && proposal.audience === "parent";
}

/** Types that must open a real form and execute — never record-only "approved". */
export function isFormExecuteProposal(type?: string | null): boolean {
  return (
    isCalendarUpdateProposal(type) ||
    isLogExpenseProposal(type) ||
    isLogDocumentProposal(type)
  );
}
