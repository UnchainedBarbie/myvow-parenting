/**
 * Apply a turn arbitration to stored Sage items.
 *
 * A revise replaces the current version of the named task. A cancel dismisses that task's live
 * proposals. Conversation and unread readings write nothing. Approval is never granted here.
 */

import type { getServiceRoleClient } from "@/lib/supabase/server";
import { restoreDroppedEvidence } from "@/lib/sage/outbound-facts";
import { proposalId, reviseProposal } from "@/lib/sage/proposal-lifecycle";
import type { TurnArbitration } from "@/lib/sage/turn-arbitration";

type Admin = ReturnType<typeof getServiceRoleClient>;

export type AppliedTaskTurn =
  | { folded: true; relation: "revise" | "cancel"; item: { id: string; plan: Record<string, unknown> } }
  | { folded: false };

function asRecord(raw: unknown): Record<string, unknown> | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  return raw as Record<string, unknown>;
}

function draftOf(row: Record<string, unknown>): string {
  const revised = typeof row.revised_text === "string" ? row.revised_text.trim() : "";
  if (revised) return revised;
  return typeof row.draft === "string" ? row.draft.trim() : "";
}

function outgoingDraft(proposals: unknown[]): string | null {
  for (const raw of proposals) {
    const row = asRecord(raw);
    if (!row) continue;
    if (row.type === "reply_coparent" || row.type === "ask_clarification") {
      const text = draftOf(row);
      if (text) return text;
    }
  }
  return null;
}

async function loadOwnedPlan(
  admin: Admin,
  itemId: string,
  userId: string
): Promise<{ plan: Record<string, unknown>; proposals: unknown[] } | null> {
  const { data } = await admin
    .from("sage_items")
    .select("plan")
    .eq("id", itemId)
    .eq("visible_to", userId)
    .maybeSingle();
  const plan =
    data && typeof (data as { plan?: unknown }).plan === "object" && (data as { plan?: unknown }).plan
      ? ((data as { plan: Record<string, unknown> }).plan)
      : null;
  if (!plan) return null;
  const proposals = Array.isArray(plan.proposals) ? plan.proposals : [];
  return { plan, proposals };
}

async function savePlan(
  admin: Admin,
  itemId: string,
  userId: string,
  plan: Record<string, unknown>
): Promise<boolean> {
  const { data, error } = await admin
    .from("sage_items")
    .update({ plan })
    .eq("id", itemId)
    .eq("visible_to", userId)
    .select("id");
  if (error || !data?.length) {
    console.error("[sage/open-task] save failed:", error?.message ?? "no row updated");
    return false;
  }
  return true;
}

function proposalIndex(proposals: unknown[], proposalIdValue: string | null): number {
  if (!proposalIdValue) return -1;
  return proposals.findIndex((raw) => proposalId(raw) === proposalIdValue);
}

/**
 * Revise the named task with this turn's outgoing draft, keeping prior versions and evidence.
 * The replacement is not approved.
 */
export async function applyTaskRevision(opts: {
  admin: Admin;
  userId: string;
  itemId: string;
  proposalId: string | null;
  nextDraft: string;
  previousDraft?: string;
  guidance?: string;
  privateObjective?: string | null;
}): Promise<{ id: string; plan: Record<string, unknown> } | null> {
  const loaded = await loadOwnedPlan(opts.admin, opts.itemId, opts.userId);
  if (!loaded) return null;
  const index = proposalIndex(loaded.proposals, opts.proposalId);
  if (index < 0) return null;
  const current = asRecord(loaded.proposals[index]);
  if (!current) return null;
  const previous = opts.previousDraft ?? draftOf(current);
  const next = restoreDroppedEvidence(opts.nextDraft.trim(), previous, opts.guidance ?? "");
  if (!next) return null;
  const revised = reviseProposal(loaded.proposals, index, {
    draft: next,
    revised_text: next,
    ...(opts.privateObjective ? { private_objective: opts.privateObjective } : {}),
    approved: false,
  });
  if (!revised) return null;
  const plan = { ...loaded.plan, proposals: revised.proposals };
  if (!(await savePlan(opts.admin, opts.itemId, opts.userId, plan))) return null;
  return { id: opts.itemId, plan };
}

/** Dismiss live proposals of the named task. Executed and already-closed rows stay as they are. */
export async function dismissTaskProposals(opts: {
  admin: Admin;
  userId: string;
  itemId: string;
}): Promise<{ id: string; plan: Record<string, unknown> } | null> {
  const loaded = await loadOwnedPlan(opts.admin, opts.itemId, opts.userId);
  if (!loaded) return null;
  const now = new Date().toISOString();
  let changed = false;
  const proposals = loaded.proposals.map((raw) => {
    const row = asRecord(raw);
    if (!row) return raw;
    const status = typeof row.status === "string" ? row.status.trim().toLowerCase() : "";
    if (row.executed === true || row.approved === true) return raw;
    if (
      status === "executed" ||
      status === "completed" ||
      status === "dismissed" ||
      status === "canceled" ||
      status === "superseded" ||
      status === "expired"
    ) {
      return raw;
    }
    changed = true;
    return { ...row, status: "dismissed", dismissed_at: now };
  });
  if (!changed) return null;
  const plan = { ...loaded.plan, proposals };
  if (!(await savePlan(opts.admin, opts.itemId, opts.userId, plan))) return null;
  return { id: opts.itemId, plan };
}

/**
 * Fold this turn into the named task when arbitration says revise or cancel.
 * Unread, conversation, continue, and new_task leave storage to the existing insert path.
 */
export async function applyTurnToTasks(opts: {
  admin: Admin;
  userId: string;
  decision: TurnArbitration | null | undefined;
  proposals: unknown[];
  guidance?: string;
  privateObjective?: string | null;
}): Promise<AppliedTaskTurn> {
  const decision = opts.decision;
  if (!decision || decision.unread) return { folded: false };
  if (!decision.currentItemId) return { folded: false };
  if (decision.relation === "cancel") {
    const item = await dismissTaskProposals({
      admin: opts.admin,
      userId: opts.userId,
      itemId: decision.currentItemId,
    });
    if (!item) return { folded: false };
    return { folded: true, relation: "cancel", item };
  }
  if (decision.relation !== "revise" && decision.relation !== "change_outcome") {
    return { folded: false };
  }
  const nextDraft = outgoingDraft(opts.proposals);
  if (!nextDraft) return { folded: false };
  const item = await applyTaskRevision({
    admin: opts.admin,
    userId: opts.userId,
    itemId: decision.currentItemId,
    proposalId: decision.currentProposalId,
    nextDraft,
    guidance: opts.guidance,
    privateObjective: opts.privateObjective,
  });
  if (!item) return { folded: false };
  return { folded: true, relation: "revise", item };
}
