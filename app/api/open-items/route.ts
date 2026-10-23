import { NextRequest, NextResponse } from "next/server";
import type { SageItem } from "@/components/sage/proposal-types";
import { deriveOpenItems, openItemHref, type OpenItemSource } from "@/lib/open-items";
import { ownerItemMatch, reconcileProposalPlan, supersededExecutionError } from "@/lib/sage/proposal-lifecycle";
import {
  dismissProposalRecord,
  isResolvedProposal,
  reconcileResolvedProposals,
  type SentReplyLink,
} from "@/lib/sage/proposal-resolution";
import { dismissStaleIntakeProposals } from "@/lib/sage/apply-intake-correction";
import { createClient, getServiceRoleClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

const ITEM_SELECT =
  "id, item_type, domain, summary, evidence_excerpt, urgency, action_required, child_ids, tool_input, plan, status, flagged, created_at, source_type, source_id";

type ItemRow = OpenItemSource & {
  source_id?: string | null;
  urgency?: string | null;
  child_ids?: string[] | null;
  tool_input?: unknown;
  flagged?: boolean | null;
};

/**
 * GET /api/open-items
 * Pending proposals for the signed-in parent. Rows are limited to sage_items
 * with visible_to = this user, which is the same boundary as Sage chat.
 */
export async function GET() {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const admin = getServiceRoleClient();
    const { data: membership, error: membershipError } = await admin
      .from("case_members")
      .select("case_id")
      .eq("user_id", user.id)
      .limit(1)
      .maybeSingle();

    if (membershipError) {
      console.error("[open-items/GET] membership:", membershipError);
      return NextResponse.json({ error: "Couldn't load open items." }, { status: 500 });
    }

    if (!membership?.case_id) {
      return NextResponse.json({
        count: 0,
        caseId: null,
        children: [],
        items: [],
      });
    }

    const caseId = membership.case_id as string;
    const { data: rows, error: itemsError } = await admin
      .from("sage_items")
      .select(ITEM_SELECT)
      .eq("case_id", caseId)
      .eq("visible_to", user.id)
      .order("created_at", { ascending: false });

    if (itemsError) {
      console.error("[open-items/GET] sage_items:", itemsError);
      return NextResponse.json({ error: "Couldn't load open items." }, { status: 500 });
    }

    const items = (rows ?? []) as ItemRow[];
    await dismissStaleIntakeProposals(admin, {
      userId: user.id,
      userEmail: user.email,
      caseId,
      items,
    });
    const sentReplies = await sentReplyLinks(admin, caseId, items);
    await reconcileStoredPlans(admin, user.id, caseId, items, sentReplies);
    const drafts = deriveOpenItems(items);
    const needed = new Set(drafts.map((draft) => draft.sageItemId));
    const relevant = items.filter((row) => needed.has(row.id));

    const sessionByItem = await sessionsForItems(admin, user.id, relevant);
    const byId = new Map(items.map((row) => [row.id, row]));

    const { data: childrenData, error: childrenError } = await admin
      .from("children")
      .select("id, first_name")
      .eq("case_id", caseId)
      .is("deleted_at", null)
      .order("first_name");
    if (childrenError) {
      console.error("[open-items/GET] children:", childrenError);
      return NextResponse.json({ error: "Couldn't load open items." }, { status: 500 });
    }

    return NextResponse.json(
      {
        count: drafts.length,
        caseId,
        children: (childrenData ?? []).map((child) => ({
          id: child.id as string,
          first_name: child.first_name as string,
        })),
        items: drafts.map((draft) => {
          const row = byId.get(draft.sageItemId);
          const sessionId = sessionByItem.get(draft.sageItemId) ?? null;
          return {
            ...draft,
            href: openItemHref(sessionId, draft.sageItemId, draft.proposalIndex),
            item: toSageItem(row),
          };
        }),
      },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch (e) {
    console.error("[open-items/GET]", e);
    return NextResponse.json({ error: "Couldn't load open items." }, { status: 500 });
  }
}

type DismissBody = {
  action?: unknown;
  items?: unknown;
};

/**
 * POST /api/open-items
 * { action: "dismiss", items: [{ id, proposalIndex }] }
 * Marks the same proposal chat uses as waived. Does not send, approve, or delete rows.
 */
export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = (await request.json().catch(() => ({}))) as DismissBody;
    if (body.action !== "dismiss" || !Array.isArray(body.items) || body.items.length === 0) {
      return NextResponse.json({ error: "Choose at least one open item to dismiss." }, { status: 400 });
    }

    const admin = getServiceRoleClient();
    const { data: membership, error: membershipError } = await admin
      .from("case_members")
      .select("case_id")
      .eq("user_id", user.id)
      .limit(1)
      .maybeSingle();
    if (membershipError) {
      console.error("[open-items/POST] membership:", membershipError);
      return NextResponse.json({ error: "Couldn't dismiss those items." }, { status: 500 });
    }
    if (!membership?.case_id) {
      return NextResponse.json({ error: "Couldn't dismiss those items." }, { status: 403 });
    }
    const caseId = membership.case_id as string;
    const now = new Date().toISOString();
    const dismissed: { id: string; proposalIndex: number | null }[] = [];
    const errors: { id: string; proposalIndex: number | null; error: string }[] = [];

    for (const raw of body.items.slice(0, 50)) {
      const target = raw as { id?: unknown; proposalIndex?: unknown };
      const id = typeof target.id === "string" ? target.id.trim() : "";
      const proposalIndex =
        target.proposalIndex === null
          ? null
          : typeof target.proposalIndex === "number" &&
              Number.isInteger(target.proposalIndex) &&
              target.proposalIndex >= 0
            ? target.proposalIndex
            : -1;
      if (!id || proposalIndex === -1) {
        errors.push({ id, proposalIndex: null, error: "That open item could not be dismissed." });
        continue;
      }

      const scope = ownerItemMatch(user.id, caseId, id);
      const { data: row, error: loadError } = await admin
        .from("sage_items")
        .select("id, plan, status")
        .eq("id", scope.id)
        .eq("visible_to", scope.visible_to)
        .eq("case_id", scope.case_id)
        .maybeSingle();
      if (loadError) {
        errors.push({ id, proposalIndex, error: "Couldn't dismiss that item." });
        continue;
      }
      if (!row) {
        errors.push({ id, proposalIndex, error: "That item is not available to you." });
        continue;
      }

      if (proposalIndex === null) {
        const { error: updateError } = await admin
          .from("sage_items")
          .update({ status: "dismissed" })
          .eq("id", scope.id)
          .eq("visible_to", scope.visible_to)
          .eq("case_id", scope.case_id);
        if (updateError) {
          errors.push({ id, proposalIndex, error: "Couldn't dismiss that item." });
          continue;
        }
        dismissed.push({ id, proposalIndex });
        continue;
      }

      const plan =
        row.plan && typeof row.plan === "object"
          ? { ...(row.plan as { proposals?: unknown[] }) }
          : { proposals: [] };
      const proposals = Array.isArray(plan.proposals)
        ? plan.proposals.map((entry) =>
            entry && typeof entry === "object" ? { ...(entry as Record<string, unknown>) } : {}
          )
        : [];
      if (proposalIndex >= proposals.length) {
        errors.push({ id, proposalIndex, error: "That open item could not be dismissed." });
        continue;
      }
      const replaced = supersededExecutionError(proposals, proposalIndex, id);
      if (replaced) {
        errors.push({ id, proposalIndex, error: replaced.error });
        continue;
      }
      const current = proposals[proposalIndex] as Record<string, unknown>;
      if (isResolvedProposal(current as Parameters<typeof isResolvedProposal>[0])) {
        dismissed.push({ id, proposalIndex });
        continue;
      }
      proposals[proposalIndex] = dismissProposalRecord(current, now);
      const { error: updateError } = await admin
        .from("sage_items")
        .update({ plan: { ...plan, proposals } })
        .eq("id", scope.id)
        .eq("visible_to", scope.visible_to)
        .eq("case_id", scope.case_id);
      if (updateError) {
        errors.push({ id, proposalIndex, error: "Couldn't dismiss that item." });
        continue;
      }
      dismissed.push({ id, proposalIndex });
    }

    return NextResponse.json({
      success: errors.length === 0,
      dismissed,
      errors,
    });
  } catch (e) {
    console.error("[open-items/POST]", e);
    return NextResponse.json({ error: "Couldn't dismiss those items." }, { status: 500 });
  }
}

async function sentReplyLinks(
  admin: Admin,
  caseId: string,
  items: ItemRow[]
): Promise<SentReplyLink[]> {
  const proposalIds = new Set<string>();
  for (const row of items) {
    const proposals = Array.isArray(row.plan?.proposals) ? row.plan.proposals : [];
    for (const raw of proposals) {
      if (!raw || typeof raw !== "object") continue;
      const id = (raw as { id?: unknown }).id;
      if (typeof id === "string" && id.trim()) proposalIds.add(id.trim());
    }
  }
  if (proposalIds.size === 0) return [];
  const { data, error } = await admin
    .from("messages")
    .select("id, sage_proposal_id, direction")
    .eq("case_id", caseId)
    .eq("direction", "outgoing")
    .in("sage_proposal_id", [...proposalIds]);
  if (error) {
    if (/sage_proposal_id/i.test(error.message ?? "")) return [];
    throw new Error(error.message);
  }
  const links: SentReplyLink[] = [];
  for (const row of data ?? []) {
    const proposalId = (row as { sage_proposal_id?: string | null }).sage_proposal_id?.trim() ?? "";
    const messageId = (row as { id?: string }).id?.trim() ?? "";
    if (!proposalId || !messageId || !proposalIds.has(proposalId)) continue;
    links.push({ proposalId, messageId });
  }
  return links;
}

async function reconcileStoredPlans(
  admin: Admin,
  userId: string,
  caseId: string,
  items: ItemRow[],
  sentReplies: SentReplyLink[]
) {
  for (const row of items) {
    const proposals = Array.isArray(row.plan?.proposals) ? row.plan.proposals : null;
    if (!proposals) continue;
    const versioned = reconcileProposalPlan(proposals);
    const resolved = reconcileResolvedProposals(versioned.proposals, sentReplies);
    if (!versioned.changed && !resolved.changed) continue;
    const nextPlan = { ...(row.plan as object), proposals: resolved.proposals };
    row.plan = nextPlan;
    const scope = ownerItemMatch(userId, caseId, row.id);
    const { error } = await admin
      .from("sage_items")
      .update({ plan: nextPlan })
      .eq("id", scope.id)
      .eq("visible_to", scope.visible_to)
      .eq("case_id", scope.case_id);
    if (error) console.error("[open-items/GET] reconcile:", error);
  }
}

function toSageItem(row: ItemRow | undefined): SageItem | null {
  if (!row) return null;
  return {
    id: row.id,
    item_type: row.item_type ?? null,
    domain: row.domain ?? null,
    summary: row.summary ?? null,
    evidence_excerpt: row.evidence_excerpt ?? null,
    urgency: row.urgency ?? null,
    action_required: row.action_required ?? null,
    child_ids: row.child_ids ?? null,
    tool_input: row.tool_input ?? null,
    plan:
      row.plan && typeof row.plan === "object"
        ? (row.plan as SageItem["plan"])
        : null,
    status: row.status ?? null,
    flagged: row.flagged ?? null,
    created_at: row.created_at,
  };
}

type Admin = ReturnType<typeof getServiceRoleClient>;

async function sessionsForItems(
  admin: Admin,
  userId: string,
  items: ItemRow[]
): Promise<Map<string, string>> {
  const result = new Map<string, string>();
  if (items.length === 0) return result;

  const itemIds = items.map((row) => row.id);
  const sourceIds = items
    .map((row) => (typeof row.source_id === "string" ? row.source_id : ""))
    .filter((id) => id.length > 0);

  const { data: linked, error: linkedError } = await admin
    .from("sage_journal_messages")
    .select("id, session_id, sage_item_id, created_at")
    .eq("user_id", userId)
    .in("sage_item_id", itemIds)
    .order("created_at", { ascending: false });

  let journals = (linked ?? []) as {
    id: string;
    session_id?: string | null;
    sage_item_id?: string | null;
  }[];

  if (linkedError && /sage_item_id/i.test(linkedError.message ?? "")) {
    journals = [];
  } else if (linkedError) {
    throw new Error(linkedError.message);
  }

  let sourceJournals: { id: string; session_id?: string | null }[] = [];
  if (sourceIds.length > 0) {
    const { data: sources, error: sourceError } = await admin
      .from("sage_journal_messages")
      .select("id, session_id")
      .eq("user_id", userId)
      .in("id", sourceIds);
    if (sourceError) throw new Error(sourceError.message);
    sourceJournals = (sources ?? []) as { id: string; session_id?: string | null }[];
  }

  const sessionIds = [
    ...journals.map((row) => row.session_id),
    ...sourceJournals.map((row) => row.session_id),
  ].filter((id): id is string => typeof id === "string" && id.length > 0);

  if (sessionIds.length === 0) return result;

  const { data: sessions, error: sessionError } = await admin
    .from("sage_sessions")
    .select("id")
    .eq("user_id", userId)
    .in("id", [...new Set(sessionIds)]);
  if (sessionError) throw new Error(sessionError.message);

  const allowed = new Set((sessions ?? []).map((row) => row.id as string));
  for (const row of journals) {
    if (!row.sage_item_id || !row.session_id || !allowed.has(row.session_id)) continue;
    if (!result.has(row.sage_item_id)) result.set(row.sage_item_id, row.session_id);
  }
  const bySource = new Map<string, string>();
  for (const row of sourceJournals) {
    if (row.session_id && allowed.has(row.session_id)) bySource.set(row.id, row.session_id);
  }
  for (const item of items) {
    if (result.has(item.id)) continue;
    const sourceId = typeof item.source_id === "string" ? item.source_id : "";
    const sessionId = sourceId ? bySource.get(sourceId) : undefined;
    if (sessionId) result.set(item.id, sessionId);
  }
  return result;
}
