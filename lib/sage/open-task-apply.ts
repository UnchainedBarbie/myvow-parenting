/**
 * Apply a turn arbitration to stored Sage items.
 *
 * A revise replaces the current version of the named task. A cancel dismisses that task's live
 * proposals. Conversation and unread readings write nothing. Approval is never granted here.
 */

import type { getServiceRoleClient } from "@/lib/supabase/server";
import { isParentFacingCopy, requestAsDraft, restoreDroppedEvidence } from "@/lib/sage/outbound-facts";
import { taskIdOf } from "@/lib/sage/open-task";
import { proposalId, reviseProposal } from "@/lib/sage/proposal-lifecycle";
import type { TurnArbitration } from "@/lib/sage/turn-arbitration";

type Admin = ReturnType<typeof getServiceRoleClient>;

export type AppliedTaskTurn =
  | {
      folded: true;
      relation: "revise" | "cancel";
      item: { id: string; plan: Record<string, unknown> };
      unchanged?: boolean;
    }
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

function outgoingMessage(proposals: unknown[]): {
  draft: string;
  privateObjective: string | null;
  groundedIn: Record<string, unknown> | null;
} | null {
  for (const raw of proposals) {
    const row = asRecord(raw);
    if (!row) continue;
    if (row.type === "reply_coparent" || row.type === "ask_clarification") {
      const text = draftOf(row);
      if (!text) continue;
      const grounded = asRecord(row.grounded_in);
      const privateObjective = typeof row.private_objective === "string" ? row.private_objective.trim() : "";
      return {
        draft: text,
        privateObjective: privateObjective || null,
        groundedIn: grounded,
      };
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
  groundedIn?: Record<string, unknown> | null;
}): Promise<{ id: string; plan: Record<string, unknown>; unchanged?: boolean } | null> {
  const loaded = await loadOwnedPlan(opts.admin, opts.itemId, opts.userId);
  if (!loaded) return null;
  const index = proposalIndex(loaded.proposals, opts.proposalId);
  if (index < 0) return null;
  const current = asRecord(loaded.proposals[index]);
  if (!current) return null;
  const previous = opts.previousDraft ?? draftOf(current);
  const next = restoreDroppedEvidence(opts.nextDraft.trim(), previous, opts.guidance ?? "");
  if (!next || isParentFacingCopy(next) || (opts.guidance && requestAsDraft(next, opts.guidance))) return null;
  if (next.trim() === previous.trim()) {
    return { id: opts.itemId, plan: loaded.plan, unchanged: true };
  }
  const revised = reviseProposal(loaded.proposals, index, {
    draft: next,
    revised_text: next,
    ...(opts.privateObjective ? { private_objective: opts.privateObjective } : {}),
    ...(opts.groundedIn ? { grounded_in: opts.groundedIn } : {}),
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
  /** An approved message that was never sent can still be canceled. */
  includeApprovedUnsent?: boolean;
}): Promise<{ id: string; plan: Record<string, unknown> } | null> {
  const loaded = await loadOwnedPlan(opts.admin, opts.itemId, opts.userId);
  if (!loaded) return null;
  const now = new Date().toISOString();
  let changed = false;
  const proposals = loaded.proposals.map((raw) => {
    const row = asRecord(raw);
    if (!row) return raw;
    const status = typeof row.status === "string" ? row.status.trim().toLowerCase() : "";
    if (row.executed === true) return raw;
    if (!opts.includeApprovedUnsent && row.approved === true) return raw;
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
 * Remove the stored objective from message proposals only.
 * Calendar, expense, and other proposals in the same plan are left as they are.
 * The draft text stays. The question, outcome, and private objective do not.
 */
export function clearReplyObjective(proposals: unknown[]): unknown[] {
  return proposals.map((raw) => {
    const row = asRecord(raw);
    if (!row || row.type !== "reply_coparent") return raw;
    if (!("grounded_in" in row) && !("private_objective" in row)) return raw;
    const next = { ...row };
    delete next.grounded_in;
    delete next.private_objective;
    return next;
  });
}

/**
 * Drop the established objective on one message task after a terminal review failure.
 * Other tasks, and calendar or expense proposals, are not written. The journal is not written.
 */
export async function clearStoredMessageObjective(opts: {
  admin: Admin;
  userId: string;
  sessionId: string;
  taskId: string;
}): Promise<void> {
  const taskId = opts.taskId.trim();
  const sessionId = opts.sessionId.trim();
  if (!taskId || !sessionId) return;
  const { data: journals, error: journalErr } = await opts.admin
    .from("sage_journal_messages")
    .select("sage_item_id")
    .eq("session_id", sessionId)
    .eq("user_id", opts.userId)
    .not("sage_item_id", "is", null);
  if (journalErr || !journals) return;
  const itemIds = [
    ...new Set(
      (journals as { sage_item_id?: string | null }[])
        .map((row) => row.sage_item_id)
        .filter((id): id is string => typeof id === "string" && id.length > 0)
    ),
  ];
  if (itemIds.length === 0) return;
  const { data: items, error } = await opts.admin
    .from("sage_items")
    .select("id, plan")
    .in("id", itemIds)
    .eq("visible_to", opts.userId);
  if (error || !items) return;
  for (const row of items as { id?: string | null; plan?: unknown }[]) {
    const id = typeof row.id === "string" ? row.id : "";
    const plan =
      row.plan && typeof row.plan === "object" && !Array.isArray(row.plan)
        ? (row.plan as Record<string, unknown>)
        : null;
    if (!id || !plan) continue;
    if (taskIdOf({ id, plan }) !== taskId) continue;
    const proposals = Array.isArray(plan.proposals) ? plan.proposals : [];
    const next = clearReplyObjective(proposals);
    if (next.every((item, index) => item === proposals[index])) continue;
    await savePlan(opts.admin, id, opts.userId, { ...plan, proposals: next });
  }
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
  groundedIn?: Record<string, unknown> | null;
}): Promise<AppliedTaskTurn> {
  const decision = opts.decision;
  if (!decision || decision.unread) return { folded: false };
  if (decision.relation === "cancel") {
    const ids =
      decision.closeItemIds && decision.closeItemIds.length > 0
        ? decision.closeItemIds
        : decision.currentItemId
          ? [decision.currentItemId]
          : [];
    let last: { id: string; plan: Record<string, unknown> } | null = null;
    for (const itemId of ids) {
      const item = await dismissTaskProposals({
        admin: opts.admin,
        userId: opts.userId,
        itemId,
        includeApprovedUnsent: true,
      });
      if (item) last = item;
    }
    if (!last) return { folded: false };
    return { folded: true, relation: "cancel", item: last };
  }
  if (!decision.currentItemId) return { folded: false };
  if (decision.relation !== "revise" && decision.relation !== "change_outcome") {
    return { folded: false };
  }
  const outgoing = outgoingMessage(opts.proposals);
  if (!outgoing) return { folded: false };
  const item = await applyTaskRevision({
    admin: opts.admin,
    userId: opts.userId,
    itemId: decision.currentItemId,
    proposalId: decision.currentProposalId,
    nextDraft: outgoing.draft,
    guidance: opts.guidance,
    privateObjective: outgoing.privateObjective ?? opts.privateObjective,
    groundedIn: outgoing.groundedIn ?? opts.groundedIn ?? null,
  });
  if (!item) return { folded: false };
  return { folded: true, relation: "revise", item, unchanged: item.unchanged === true };
}
