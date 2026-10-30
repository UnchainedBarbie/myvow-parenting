import type { getServiceRoleClient } from "@/lib/supabase/server";
import { restoreDroppedEvidence } from "@/lib/sage/outbound-facts";
import { redraftMessage } from "@/lib/sage/planner";
import { isParentFacingQuestion } from "@/lib/sage/proposal-kind";
import { isInactiveProposal, proposalId, reviseProposal } from "@/lib/sage/proposal-lifecycle";
import { loadSessionItems } from "@/lib/sage/session-items";

type Admin = ReturnType<typeof getServiceRoleClient>;

/**
 * Outgoing drafts the parent has not sent yet: a reply or a clarification addressed to the
 * co-parent, and an unsaved calendar suggestion. A question Sage asked the parent is a different
 * object and never appears here, so free text typed in chat can never be written into it.
 */
export type RevisableDraft = {
  itemId: string;
  summary: string;
  proposalType: "reply_coparent" | "ask_clarification" | "calendar_update";
  proposalIndex: number;
  currentDraft: string;
  sourceType: string | null;
  audience: "parent" | "coparent" | null;
  plan: Record<string, unknown>;
  proposals: Record<string, unknown>[];
};

export function revisionReply(
  proposalType: "reply_coparent" | "ask_clarification" | "calendar_update"
): string {
  if (proposalType === "calendar_update") return "Updated that calendar suggestion.";
  return proposalType === "ask_clarification"
    ? "Added that to your question to Co-Parent."
    : "Added that to your reply to Co-Parent.";
}

export function isClosedProposal(raw: unknown): boolean {
  return isInactiveProposal(raw);
}

export function openCalendarProposal(raw: unknown): {
  draft?: string;
  revised_text?: string;
  date?: string;
} | null {
  if (!raw || typeof raw !== "object") return null;
  const proposal = raw as {
    type?: string;
    draft?: string;
    revised_text?: string;
    date?: string;
  };
  if (proposal.type !== "calendar_update") return null;
  if (isClosedProposal(proposal)) return null;
  return {
    draft: proposal.draft,
    revised_text: proposal.revised_text,
    date: proposal.date,
  };
}

/** A live message to the co-parent. A live question to the parent returns null. */
export function openReplyProposal(
  raw: unknown,
  sourceType: string | null = null
): {
  type: "reply_coparent" | "ask_clarification";
  draft?: string;
  revised_text?: string;
} | null {
  if (!raw || typeof raw !== "object") return null;
  const proposal = raw as {
    type?: string;
    audience?: string;
    draft?: string;
    revised_text?: string;
  };
  if (isClosedProposal(proposal)) return null;
  if (proposal.type !== "reply_coparent" && proposal.type !== "ask_clarification") {
    return null;
  }
  if (isParentFacingQuestion(proposal, sourceType)) return null;
  return {
    type: proposal.type,
    draft: proposal.draft,
    revised_text: proposal.revised_text,
  };
}

/** depends_on is free text. Unsatisfied means that text is set and unblocked is not. */
export function unsatisfiedDependsOn(raw: unknown): boolean {
  if (!raw || typeof raw !== "object") return false;
  const proposal = raw as { depends_on?: unknown; unblocked?: boolean };
  if (proposal.unblocked === true) return false;
  return typeof proposal.depends_on === "string" && proposal.depends_on.trim() !== "";
}

/**
 * The outgoing draft most recently added in this session that is still waiting.
 * Item status is ignored: approving one proposal marks the whole item in_progress.
 * blockedOnly limits that to a proposal whose depends_on is set and not yet unblocked.
 */
export async function latestRevisableDraft(
  admin: Admin,
  sessionId: string | null,
  userId: string,
  opts?: { blockedOnly?: boolean; calendarOnly?: boolean; includeCalendar?: boolean }
): Promise<RevisableDraft | null> {
  const items = await loadSessionItems(admin, sessionId, userId);
  for (const row of items) {
    if (!row.plan || typeof row.plan !== "object") continue;
    const proposals = Array.isArray(row.plan.proposals) ? (row.plan.proposals as unknown[]) : [];
    let chosen: RevisableDraft | null = null;
    proposals.forEach((raw, proposalIndex) => {
      const calendar =
        opts?.calendarOnly || opts?.includeCalendar ? openCalendarProposal(raw) : null;
      const reply = opts?.calendarOnly ? null : openReplyProposal(raw, row.source_type);
      const proposal = calendar ?? reply;
      if (!proposal) return;
      if (opts?.blockedOnly && !unsatisfiedDependsOn(raw)) return;
      const currentDraft =
        typeof proposal.revised_text === "string" && proposal.revised_text.trim()
          ? proposal.revised_text.trim()
          : typeof proposal.draft === "string"
            ? proposal.draft.trim()
            : "";
      const audienceRaw =
        raw && typeof raw === "object" ? (raw as { audience?: unknown }).audience : null;
      chosen = {
        itemId: row.id,
        summary: (row.summary ?? "").trim(),
        proposalType: calendar
          ? "calendar_update"
          : (proposal as { type: "reply_coparent" | "ask_clarification" }).type,
        proposalIndex,
        currentDraft,
        sourceType: typeof row.source_type === "string" ? row.source_type : null,
        audience: audienceRaw === "parent" || audienceRaw === "coparent" ? audienceRaw : null,
        plan: row.plan as Record<string, unknown>,
        proposals: proposals.map((p) =>
          p && typeof p === "object" ? { ...(p as Record<string, unknown>) } : {}
        ),
      };
    });
    if (chosen) return chosen;
  }
  return null;
}

/** The named outgoing draft, not whichever draft happens to be newest. */
export async function revisableDraftById(
  admin: Admin,
  userId: string,
  itemId: string,
  proposalIdValue: string | null
): Promise<RevisableDraft | null> {
  const { data } = await admin
    .from("sage_items")
    .select("id, summary, plan, source_type")
    .eq("id", itemId)
    .eq("visible_to", userId)
    .maybeSingle();
  if (!data || typeof (data as { plan?: unknown }).plan !== "object" || !(data as { plan?: unknown }).plan) {
    return null;
  }
  const row = data as {
    id: string;
    summary?: string | null;
    source_type?: string | null;
    plan: { proposals?: unknown[] };
  };
  const proposals = Array.isArray(row.plan.proposals) ? row.plan.proposals : [];
  const index = proposalIdValue
    ? proposals.findIndex((raw) => proposalId(raw) === proposalIdValue)
    : proposals.findIndex((raw) => openReplyProposal(raw, row.source_type) || openCalendarProposal(raw));
  if (index < 0) return null;
  const raw = proposals[index];
  const calendar = openCalendarProposal(raw);
  const reply = openReplyProposal(raw, row.source_type);
  const proposal = calendar ?? reply;
  if (!proposal) return null;
  const currentDraft =
    typeof proposal.revised_text === "string" && proposal.revised_text.trim()
      ? proposal.revised_text.trim()
      : typeof proposal.draft === "string"
        ? proposal.draft.trim()
        : "";
  const audienceRaw = raw && typeof raw === "object" ? (raw as { audience?: unknown }).audience : null;
  return {
    itemId: row.id,
    summary: (row.summary ?? "").trim(),
    proposalType: calendar ? "calendar_update" : (proposal as { type: "reply_coparent" | "ask_clarification" }).type,
    proposalIndex: index,
    currentDraft,
    sourceType: typeof row.source_type === "string" ? row.source_type : null,
    audience: audienceRaw === "parent" || audienceRaw === "coparent" ? audienceRaw : null,
    plan: row.plan as Record<string, unknown>,
    proposals: proposals.map((p) => (p && typeof p === "object" ? { ...(p as Record<string, unknown>) } : {})),
  };
}

/** The writer that turns the parent's guidance into new draft text. Tests inject their own. */
export type Redrafter = typeof redraftMessage;

export async function revisePendingDraft(opts: {
  admin: Admin;
  userId: string;
  guidance: string;
  target: RevisableDraft;
  clearDependsOn?: boolean;
  sources?: string;
  event?: string | null;
  child?: string | null;
  redraft?: Redrafter;
}): Promise<{ reply: string; item: { id: string; plan: Record<string, unknown> } } | null> {
  if (opts.target.proposalType === "calendar_update") return null;
  // A question addressed to the parent is answered, never rewritten as an outgoing message.
  if (isParentFacingQuestion(
    { type: opts.target.proposalType, audience: opts.target.audience },
    opts.target.sourceType
  )) {
    return null;
  }
  const { data: fresh } = await opts.admin
    .from("sage_items")
    .select("plan")
    .eq("id", opts.target.itemId)
    .eq("visible_to", opts.userId)
    .maybeSingle();
  const freshPlan =
    fresh &&
    typeof (fresh as { plan?: unknown }).plan === "object" &&
    (fresh as { plan?: unknown }).plan
      ? (fresh as { plan: { proposals?: unknown[] } }).plan
      : null;
  const live = Array.isArray(freshPlan?.proposals)
    ? freshPlan.proposals[opts.target.proposalIndex]
    : opts.target.proposals[opts.target.proposalIndex];
  if (isClosedProposal(live)) return null;
  const redraft = await (opts.redraft ?? redraftMessage)({
    summary: opts.target.summary,
    proposalType: opts.target.proposalType,
    currentDraft: opts.target.currentDraft,
    guidance: opts.guidance,
    sourceType: opts.target.sourceType,
    audience: opts.target.audience,
    sources: opts.sources,
    event: opts.event,
    child: opts.child,
  });
  const revisedText = restoreDroppedEvidence(
    redraft?.trim() ?? "",
    opts.target.currentDraft,
    opts.guidance
  );
  if (!revisedText) return null;

  const proposals = (Array.isArray(freshPlan?.proposals) ? freshPlan.proposals : opts.target.proposals).map(
    (p) => (p && typeof p === "object" ? { ...(p as Record<string, unknown>) } : {})
  );
  const revised = reviseProposal(proposals, opts.target.proposalIndex, {
    draft: revisedText,
    revised_text: revisedText,
    ...(opts.clearDependsOn ? { depends_on: null, date_supplied: true } : {}),
  });
  if (!revised) return null;
  const updatedPlan = { ...(freshPlan ?? opts.target.plan), proposals: revised.proposals };
  const { data, error } = await opts.admin
    .from("sage_items")
    .update({ plan: updatedPlan })
    .eq("id", opts.target.itemId)
    .eq("visible_to", opts.userId)
    .select("id");
  if (error || !data?.length) {
    console.error(
      "[sage/messages] revise pending draft failed:",
      error?.message ?? "no row updated"
    );
    return null;
  }
  return {
    reply: revisionReply(opts.target.proposalType),
    item: { id: opts.target.itemId, plan: updatedPlan },
  };
}
