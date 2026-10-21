/**
 * Proposal versions live on sage_items.plan.proposals. A revision freezes the
 * previous object and appends a replacement. The link is the proposal id
 * (supersedes / superseded_by), never a shared title, date, type, or conversation.
 * No extra table: the plan JSON already stores each proposal.
 */

export type ProposalRecord = Record<string, unknown>;

const RESULT_KEYS = [
  "result_event_id",
  "result_expense_id",
  "result_document_id",
  "result_message_id",
] as const;

const TERMINAL_STATUS = new Set([
  "waived_by_user",
  "approved",
  "executed",
  "declined",
  "canceled",
  "cancelled",
  "dismissed",
  "completed",
  "superseded",
]);

export type CurrentVersion = {
  proposalId: string;
  proposalIndex: number;
  itemId: string | null;
};

export type SupersededRejection = {
  error: string;
  current_proposal_id: string | null;
  current_proposal_index: number | null;
  current_item_id: string | null;
};

export function proposalId(raw: unknown): string {
  if (!raw || typeof raw !== "object") return "";
  const id = (raw as { id?: unknown }).id;
  return typeof id === "string" ? id.trim() : "";
}

export function isSupersededProposal(raw: unknown): boolean {
  if (!raw || typeof raw !== "object") return false;
  const proposal = raw as { status?: unknown; superseded_by?: unknown };
  const status = typeof proposal.status === "string" ? proposal.status.trim().toLowerCase() : "";
  if (status === "superseded") return true;
  return typeof proposal.superseded_by === "string" && proposal.superseded_by.trim().length > 0;
}

/** Closed for a further revision. save_failed stays open so recovery can move forward. */
export function isInactiveProposal(raw: unknown): boolean {
  if (!raw || typeof raw !== "object") return false;
  if (isSupersededProposal(raw)) return true;
  const proposal = raw as {
    executed?: boolean;
    approved?: boolean;
    approved_at?: unknown;
    status?: unknown;
  };
  if (proposal.executed === true || proposal.approved === true) return true;
  if (typeof proposal.approved_at === "string" && proposal.approved_at.trim()) return true;
  const status = typeof proposal.status === "string" ? proposal.status.trim().toLowerCase() : "";
  return TERMINAL_STATUS.has(status);
}

function isSaveFailed(proposal: ProposalRecord): boolean {
  const status = typeof proposal.status === "string" ? proposal.status.trim().toLowerCase() : "";
  if (status === "save_failed") return true;
  return typeof proposal.save_error === "string" && proposal.save_error.trim().length > 0;
}

function resultValue(proposal: ProposalRecord, key: (typeof RESULT_KEYS)[number]): string {
  const value = proposal[key];
  return typeof value === "string" ? value.trim() : "";
}

function hasResultId(proposal: ProposalRecord): boolean {
  return RESULT_KEYS.some((key) => resultValue(proposal, key).length > 0);
}

function asRecord(raw: unknown): ProposalRecord | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  return { ...(raw as ProposalRecord) };
}

export function ensureProposalId(proposal: ProposalRecord): string {
  const existing = proposalId(proposal);
  if (existing) return existing;
  const id = crypto.randomUUID();
  proposal.id = id;
  return id;
}

export function assignProposalIds<T>(proposals: T[]): T[] {
  return proposals.map((raw) => {
    const record = asRecord(raw);
    if (!record) return raw;
    ensureProposalId(record);
    return record as T;
  });
}

export function withProposalIds<T extends { proposals?: unknown[] }>(plan: T): T {
  const proposals = Array.isArray(plan.proposals) ? plan.proposals : [];
  return {
    ...plan,
    proposals: assignProposalIds(proposals) as T["proposals"],
  };
}

export type RevisionResult = {
  proposals: ProposalRecord[];
  previousIndex: number;
  replacementIndex: number;
  previousId: string;
  replacementId: string;
};

/**
 * Freeze proposals[index] as superseded and insert the replacement immediately
 * after it. The replacement is not approved. A partial save keeps its result id
 * on the replacement so Retry save finishes that same record.
 */
export function reviseProposal(
  proposals: unknown[],
  index: number,
  changes: ProposalRecord,
  opts?: { replacementItemId?: string }
): RevisionResult | null {
  if (!Number.isInteger(index) || index < 0 || index >= proposals.length) return null;
  const current = asRecord(proposals[index]);
  if (!current) return null;
  if (current.type === "note_only") return null;
  if (isInactiveProposal(current)) return null;

  const previousId = ensureProposalId(current);
  const replacementId = crypto.randomUUID();
  const frozen: ProposalRecord = {
    ...current,
    id: previousId,
    status: "superseded",
    superseded_by: replacementId,
  };
  if (opts?.replacementItemId) frozen.replacement_item_id = opts.replacementItemId;

  const replacement: ProposalRecord = {
    ...current,
    ...changes,
    id: replacementId,
    supersedes: previousId,
  };
  delete replacement.superseded_by;
  delete replacement.replacement_item_id;
  delete replacement.executed;
  delete replacement.executed_at;
  delete replacement.approved;
  delete replacement.approved_at;
  delete replacement.waived_at;

  const revisedText = changes.revised_text;
  if (typeof revisedText === "string" && revisedText.trim()) {
    replacement.revised_text = revisedText.trim();
  } else {
    delete replacement.revised_text;
  }

  const failed = isSaveFailed(current) && hasResultId(current);
  if (failed) {
    replacement.status = "save_failed";
    if (typeof current.save_error === "string" && current.save_error.trim()) {
      replacement.save_error = current.save_error;
    }
    for (const key of RESULT_KEYS) {
      const inherited = resultValue(current, key);
      if (inherited) replacement[key] = inherited;
    }
  } else {
    delete replacement.save_error;
    for (const key of RESULT_KEYS) delete replacement[key];
    const nextStatus = typeof changes.status === "string" ? changes.status.trim().toLowerCase() : "";
    if (!nextStatus || nextStatus === "superseded" || nextStatus === "save_failed") {
      delete replacement.status;
    }
  }

  const next = proposals.map((raw) => asRecord(raw) ?? raw) as ProposalRecord[];
  next[index] = frozen;
  const replacementIndex = index + 1;
  next.splice(replacementIndex, 0, replacement);
  return {
    proposals: next,
    previousIndex: index,
    replacementIndex,
    previousId,
    replacementId,
  };
}

export function resolveCurrentVersion(
  proposals: unknown[],
  startIndex: number,
  itemId?: string | null
): CurrentVersion | null {
  if (!Number.isInteger(startIndex) || startIndex < 0 || startIndex >= proposals.length) {
    return null;
  }
  const seen = new Set<number>();
  let index = startIndex;
  let currentItem = itemId ?? null;
  while (index >= 0 && index < proposals.length && !seen.has(index)) {
    seen.add(index);
    const raw = proposals[index];
    if (!isSupersededProposal(raw)) {
      return { proposalId: proposalId(raw), proposalIndex: index, itemId: currentItem };
    }
    const record = raw as ProposalRecord;
    const nextId = typeof record.superseded_by === "string" ? record.superseded_by.trim() : "";
    const replacementItem =
      typeof record.replacement_item_id === "string" ? record.replacement_item_id.trim() : "";
    if (replacementItem && replacementItem !== currentItem) {
      return { proposalId: nextId, proposalIndex: -1, itemId: replacementItem };
    }
    if (!nextId) {
      return { proposalId: proposalId(raw), proposalIndex: index, itemId: currentItem };
    }
    const nextIndex = proposals.findIndex((proposal) => proposalId(proposal) === nextId);
    if (nextIndex < 0) {
      return { proposalId: nextId, proposalIndex: -1, itemId: currentItem };
    }
    index = nextIndex;
  }
  return null;
}

export function supersededExecutionError(
  proposals: unknown[],
  index: number,
  itemId?: string | null
): SupersededRejection | null {
  if (!Number.isInteger(index) || index < 0 || index >= proposals.length) return null;
  if (!isSupersededProposal(proposals[index])) return null;
  const current = resolveCurrentVersion(proposals, index, itemId);
  return {
    error: "This proposal was replaced. Use the current version.",
    current_proposal_id: current?.proposalId || null,
    current_proposal_index: current && current.proposalIndex >= 0 ? current.proposalIndex : null,
    current_item_id: current?.itemId ?? itemId ?? null,
  };
}

function copyRecovery(from: ProposalRecord, to: ProposalRecord): ProposalRecord | null {
  if (to.executed === true || isSupersededProposal(to)) return null;
  if (!isSaveFailed(from) || !hasResultId(from)) return null;
  const successor: ProposalRecord = { ...to };
  let copied = false;
  for (const key of RESULT_KEYS) {
    if (resultValue(successor, key)) continue;
    const inherited = resultValue(from, key);
    if (!inherited) continue;
    successor[key] = inherited;
    copied = true;
  }
  if (!copied) return null;
  if (successor.status !== "save_failed") successor.status = "save_failed";
  if (
    (typeof successor.save_error !== "string" || !successor.save_error.trim()) &&
    typeof from.save_error === "string" &&
    from.save_error.trim()
  ) {
    successor.save_error = from.save_error;
  }
  return successor;
}

/**
 * Repair status from proposal ids that already point at each other.
 * A second call is a no-op. Shared titles, dates, or types are not links.
 * calendar_event_id is an update target, not proof the change was applied.
 */
export function reconcileProposalPlan(proposals: unknown[]): {
  proposals: ProposalRecord[];
  changed: boolean;
} {
  const next = proposals.map((raw) => asRecord(raw) ?? {});
  let changed = false;
  const byId = new Map<string, number>();
  next.forEach((proposal, index) => {
    const id = proposalId(proposal);
    if (id && !byId.has(id)) byId.set(id, index);
  });

  for (let index = 0; index < next.length; index += 1) {
    const supersedesRaw = next[index]?.supersedes;
    const supersedes = typeof supersedesRaw === "string" ? supersedesRaw.trim() : "";
    if (!supersedes) continue;
    const previousIndex = byId.get(supersedes);
    if (previousIndex == null || previousIndex === index) continue;
    let replacementId = proposalId(next[index]);
    if (!replacementId) {
      replacementId = crypto.randomUUID();
      next[index] = { ...next[index], id: replacementId };
      byId.set(replacementId, index);
      changed = true;
    }
    const previous = next[previousIndex];
    const recovered = copyRecovery(previous, next[index]);
    if (previous.status !== "superseded" || previous.superseded_by !== replacementId) {
      next[previousIndex] = {
        ...previous,
        status: "superseded",
        superseded_by: replacementId,
      };
      changed = true;
    }
    if (recovered) {
      next[index] = recovered;
      changed = true;
    }
  }

  for (let index = 0; index < next.length; index += 1) {
    const supersededByRaw = next[index]?.superseded_by;
    const supersededBy = typeof supersededByRaw === "string" ? supersededByRaw.trim() : "";
    if (!supersededBy) continue;
    if (next[index].status !== "superseded") {
      next[index] = { ...next[index], status: "superseded" };
      changed = true;
    }
  }

  return { proposals: next, changed };
}

export function finalizeExecutedProposal(
  proposal: ProposalRecord,
  ids: { eventId?: string; expenseId?: string; documentId?: string; title?: string }
): { proposal: ProposalRecord; alreadyExecuted: boolean } {
  if (proposal.executed === true) {
    return { proposal: { ...proposal }, alreadyExecuted: true };
  }
  const nowIso = new Date().toISOString();
  const next: ProposalRecord = {
    ...proposal,
    approved: true,
    approved_at: typeof proposal.approved_at === "string" && proposal.approved_at.trim()
      ? proposal.approved_at
      : nowIso,
    executed: true,
    executed_at: nowIso,
  };
  if (ids.eventId) next.result_event_id = ids.eventId;
  if (ids.expenseId) next.result_expense_id = ids.expenseId;
  if (ids.documentId) next.result_document_id = ids.documentId;
  if (ids.title) next.title = ids.title;
  delete next.save_error;
  if (next.status === "save_failed") delete next.status;
  return { proposal: next, alreadyExecuted: false };
}

export function isReplacedProposalError(error: string | null | undefined): boolean {
  return (error ?? "").toLowerCase().includes("was replaced");
}

export function shouldRecordSaveFailure(error: string | null | undefined): boolean {
  const text = (error ?? "").toLowerCase();
  if (text.includes("already executed")) return false;
  if (text.includes("was replaced")) return false;
  return true;
}

/** Updates and reads of a proposal item stay on the signed-in parent's rows. */
export function ownerItemMatch(userId: string, caseId: string, itemId: string) {
  if (!userId.trim() || !caseId.trim() || !itemId.trim()) {
    throw new Error("Open item updates require the signed-in parent, case, and proposal item.");
  }
  return { id: itemId, visible_to: userId, case_id: caseId };
}
