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

/**
 * Sage's question to the parent, as opposed to a clarification the parent sends to a co-parent.
 * A question names its audience. A chat clarification with no audience is Sage asking the parent,
 * and a clarification from any other source is outbound. Callers use this one definition so a
 * question to the parent is never treated as an outgoing message.
 */
export function isParentFacingQuestion(
  proposal: { type?: string | null; audience?: string | null },
  sourceType?: string | null
): boolean {
  if (normalizeProposalType(proposal.type) !== "ask_clarification") return false;
  if (proposal.audience === "parent") return true;
  if (proposal.audience === "coparent") return false;
  return (sourceType ?? "").trim().toLowerCase() === "chat";
}

/** Types that must open a real form and execute — never record-only "approved". */
export function isFormExecuteProposal(type?: string | null): boolean {
  return (
    isCalendarUpdateProposal(type) ||
    isLogExpenseProposal(type) ||
    isLogDocumentProposal(type)
  );
}
