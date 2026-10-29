import type { getServiceRoleClient } from "@/lib/supabase/server";
import { isParentFacingQuestion } from "@/lib/sage/proposal-kind";
import { isLiveProposal, proposalId } from "@/lib/sage/proposal-lifecycle";
import { loadSessionItems, type SessionItemRow } from "@/lib/sage/session-items";
import { focusKindOf, type FocusKind } from "@/lib/sage/working-memory";

type Admin = ReturnType<typeof getServiceRoleClient>;
type Proposal = Record<string, unknown>;

/**
 * Lifecycle of Sage's questions to the parent.
 *
 * A clarification is closed by the work it belongs to: the turn that supplies its answer, or the
 * completion or dismissal of the proposal it was asked for. Recency never picks which question
 * closes. These helpers carry that rule, so the chat route and the inbox route apply the same one.
 */

/** Work a turn produced, such as a calendar draft or a logged expense. A question or a note is not work. */
const NON_WORK_TYPES = new Set(["ask_clarification", "note_only"]);

function asProposal(raw: unknown): Proposal | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  return raw as Proposal;
}

/** The kinds of work this turn completed. Each kind can answer an open question of the same kind. */
export function turnWorkKinds(
  proposals: readonly unknown[],
  itemType: string | null = null
): Set<FocusKind> {
  const kinds = new Set<FocusKind>();
  for (const raw of proposals) {
    const proposal = asProposal(raw);
    if (!proposal) continue;
    const type = typeof proposal.type === "string" ? proposal.type : "";
    if (!type || NON_WORK_TYPES.has(type)) continue;
    const kind = focusKindOf(proposal, itemType);
    if (kind !== "general") kinds.add(kind);
  }
  return kinds;
}

export type OpenQuestion = {
  itemId: string;
  proposalIndex: number;
  proposalId: string;
  kind: FocusKind;
  text: string;
};

function questionText(proposal: Proposal): string {
  for (const key of ["revised_text", "draft", "title"]) {
    const value = proposal[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return "";
}

/** Every live question to the parent in these items, newest item first and newest question first. */
export function openParentQuestions(items: readonly SessionItemRow[]): OpenQuestion[] {
  const found: OpenQuestion[] = [];
  for (const item of items) {
    const proposals = Array.isArray(item.plan?.proposals) ? (item.plan?.proposals as unknown[]) : [];
    for (let index = proposals.length - 1; index >= 0; index -= 1) {
      const proposal = asProposal(proposals[index]);
      if (!proposal || !isLiveProposal(proposal)) continue;
      if (!isParentFacingQuestion(proposal as { type?: string; audience?: string }, item.source_type)) continue;
      found.push({
        itemId: item.id,
        proposalIndex: index,
        proposalId: proposalId(proposal),
        kind: focusKindOf(proposal, item.item_type),
        text: questionText(proposal),
      });
    }
  }
  return found;
}

/**
 * The questions a turn answered.
 * An answer names its question by id when the router read one. Otherwise each completed kind of
 * work answers the newest open question of that same kind. Questions of other kinds stay open.
 */
export function answeredQuestions(
  open: readonly OpenQuestion[],
  turn: { kinds: ReadonlySet<FocusKind>; answersProposalId?: string | null }
): OpenQuestion[] {
  const answersId = turn.answersProposalId?.trim();
  if (answersId) {
    const named = open.find((question) => question.proposalId === answersId);
    return named ? [named] : [];
  }
  const answered: OpenQuestion[] = [];
  for (const kind of turn.kinds) {
    const match = open.find((question) => question.kind === kind);
    if (match) answered.push(match);
  }
  return answered;
}

/** Normalized words, used to compare one question with another. */
function words(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * True when a question the turn is about to add repeats one the parent is already holding.
 * The kind and the wording both match, so a different question of the same kind still opens.
 */
export function repeatsOpenQuestion(
  open: readonly OpenQuestion[],
  candidate: { kind: FocusKind; text: string }
): boolean {
  const text = words(candidate.text);
  if (!text) return false;
  return open.some((question) => question.kind === candidate.kind && words(question.text) === text);
}

/**
 * True when every proposal the turn would save is a question the parent already holds.
 * Saving it again would stack a second card that asks the same thing.
 */
export async function turnRepeatsOpenQuestions(
  admin: Admin,
  opts: {
    sessionId: string | null;
    userId: string;
    turnProposals: readonly unknown[];
    itemType: string | null;
    sourceType: string | null;
  }
): Promise<boolean> {
  if (opts.turnProposals.length === 0) return false;
  const candidates: { kind: FocusKind; text: string }[] = [];
  for (const raw of opts.turnProposals) {
    const proposal = asProposal(raw);
    if (!proposal || !isParentFacingQuestion(proposal as { type?: string; audience?: string }, opts.sourceType)) {
      return false;
    }
    candidates.push({ kind: focusKindOf(proposal, opts.itemType), text: questionText(proposal) });
  }
  const open = openParentQuestions(await loadSessionItems(admin, opts.sessionId, opts.userId));
  return candidates.every((candidate) => repeatsOpenQuestion(open, candidate));
}

/** Close the questions a turn answered. Each is closed by id and index inside its own item. */
export async function closeAnsweredQuestions(
  admin: Admin,
  opts: {
    sessionId: string | null;
    userId: string;
    turnProposals: readonly unknown[];
    answersProposalId?: string | null;
    itemType?: string | null;
  }
): Promise<OpenQuestion[]> {
  const kinds = turnWorkKinds(opts.turnProposals, opts.itemType ?? null);
  if (kinds.size === 0 && !opts.answersProposalId) return [];
  const items = await loadSessionItems(admin, opts.sessionId, opts.userId);
  const answered = answeredQuestions(openParentQuestions(items), {
    kinds,
    answersProposalId: opts.answersProposalId ?? null,
  });
  const closed: OpenQuestion[] = [];
  for (const question of answered) {
    const item = items.find((row) => row.id === question.itemId);
    if (!item?.plan || !Array.isArray(item.plan.proposals)) continue;
    const now = new Date().toISOString();
    const proposals = (item.plan.proposals as unknown[]).map((raw, index) => {
      const proposal = asProposal(raw);
      if (index !== question.proposalIndex || !proposal) return raw;
      if (question.proposalId && proposalId(proposal) !== question.proposalId) return raw;
      return { ...proposal, status: "completed", completed_at: now };
    });
    const { error } = await admin
      .from("sage_items")
      .update({ plan: { ...item.plan, proposals } })
      .eq("id", question.itemId)
      .eq("visible_to", opts.userId);
    if (error) {
      console.error("[sage/clarification] close answered question failed:", error.message);
      continue;
    }
    closed.push(question);
  }
  return closed;
}

/**
 * Resolve the questions that belong to one proposal when it finishes.
 * The questions are those in the same plan that ask the parent about the same kind of work, and
 * only once no other live proposal of that kind remains. Each is marked with the proposal that
 * closed it, so undoing that proposal reopens them. Other questions stay as they are.
 */
export function resolveOwnQuestions(
  proposals: readonly Proposal[],
  index: number,
  outcome: "completed" | "dismissed",
  opts: { itemType: string | null; sourceType: string | null; now: string }
): { proposals: Proposal[]; resolved: number[] } {
  const next = proposals.map((proposal) => ({ ...proposal }));
  const subject = next[index];
  if (!subject || subject.type === "ask_clarification" || subject.type === "note_only") {
    return { proposals: next, resolved: [] };
  }
  const subjectId = proposalId(subject);
  const kind = focusKindOf(subject, opts.itemType);
  if (kind === "general") return { proposals: next, resolved: [] };

  const otherLiveWork = next.some((proposal, i) => {
    if (i === index || !isLiveProposal(proposal)) return false;
    const type = typeof proposal.type === "string" ? proposal.type : "";
    if (!type || NON_WORK_TYPES.has(type)) return false;
    return focusKindOf(proposal, opts.itemType) === kind;
  });
  if (otherLiveWork) return { proposals: next, resolved: [] };

  const resolved: number[] = [];
  next.forEach((proposal, i) => {
    if (i === index || !isLiveProposal(proposal)) return;
    if (!isParentFacingQuestion(proposal as { type?: string; audience?: string }, opts.sourceType)) return;
    if (focusKindOf(proposal, opts.itemType) !== kind) return;
    next[i] =
      outcome === "completed"
        ? { ...proposal, status: "completed", completed_at: opts.now, closed_with: subjectId || null }
        : { ...proposal, status: "dismissed", dismissed_at: opts.now, closed_with: subjectId || null };
    resolved.push(i);
  });
  return { proposals: next, resolved };
}

/** Reopen the questions a proposal closed, when that proposal is undone. Questions the parent closed stay closed. */
export function reopenOwnQuestions(
  proposals: readonly Proposal[],
  index: number
): { proposals: Proposal[]; reopened: number[] } {
  const next = proposals.map((proposal) => ({ ...proposal }));
  const subjectId = next[index] ? proposalId(next[index]) : "";
  if (!subjectId) return { proposals: next, reopened: [] };
  const reopened: number[] = [];
  next.forEach((proposal, i) => {
    if (i === index || proposal.closed_with !== subjectId) return;
    const reopenedProposal = { ...proposal };
    delete reopenedProposal.status;
    delete reopenedProposal.completed_at;
    delete reopenedProposal.dismissed_at;
    delete reopenedProposal.closed_with;
    next[i] = reopenedProposal;
    reopened.push(i);
  });
  return { proposals: next, reopened };
}
