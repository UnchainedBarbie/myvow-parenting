import { NextRequest, NextResponse } from "next/server";
import { createClient, getServiceRoleClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

type PlanProposal = {
  type?: string;
  draft?: string;
  revised_text?: string | null;
  depends_on?: string | null;
  requires_approval?: boolean;
  approved?: boolean;
  approved_at?: string;
  chosen_date?: string;
  status?: string;
  waived_at?: string;
  unblocked?: boolean;
  executed?: boolean;
  executed_at?: string;
  result_event_id?: string;
};

type SagePlan = {
  status?: string;
  proposals?: PlanProposal[];
  reasoning?: string;
  [key: string]: unknown;
};

/**
 * GET /api/sage-inbox?status=open|flagged|archived|all
 * Authenticated parent user.
 * Returns sage_items for the user's case that are visible to them.
 * Chat-sourced rows (source_type = 'chat') stay in the conversation UI, not here.
 * Default status=open (status ≠ archived).
 * flagged = flagged = true (any archive status).
 */
export async function GET(req: NextRequest) {
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
      console.error("[sage-inbox/GET] Error loading membership:", membershipError);
      return NextResponse.json({ error: "Internal server error" }, { status: 500 });
    }

    if (!membership?.case_id) {
      return NextResponse.json({ error: "No case found" }, { status: 403 });
    }

    const caseId = membership.case_id as string;
    const statusParam = (req.nextUrl.searchParams.get("status") ?? "open").toLowerCase();
    const statusFilter =
      statusParam === "archived" ||
      statusParam === "flagged" ||
      statusParam === "all"
        ? statusParam
        : "open";

    let query = admin
      .from("sage_items")
      .select(
        "id, item_type, domain, summary, evidence_excerpt, urgency, action_required, child_ids, tool_input, plan, status, flagged, created_at"
      )
      .eq("case_id", caseId)
      .eq("visible_to", user.id)
      .neq("source_type", "chat")
      .order("created_at", { ascending: false });

    if (statusFilter === "archived") {
      query = query.eq("status", "archived");
    } else if (statusFilter === "flagged") {
      query = query.eq("flagged", true);
    } else if (statusFilter === "open") {
      query = query.neq("status", "archived");
    }
    // "all" — no status/flag filter

    const { data: items, error: itemsError } = await query;

    if (itemsError) {
      console.error("[sage-inbox/GET] Error loading sage_items:", itemsError);
      return NextResponse.json({ error: "Failed to load sage items" }, { status: 500 });
    }

    return NextResponse.json(items ?? []);
  } catch (e) {
    console.error("[sage-inbox/GET] Unhandled error:", e);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

/**
 * POST /api/sage-inbox
 * Body variants:
 *  - { id, action: "agree"|"dismiss"|"undo", proposal_indexes, dates? }
 *  - { id, action: "revise", proposal_index, revised_text }
 *  - { id, action: "execute", proposal_index, event_id }
 * Records approval/waiver/undo/revise/execute on plan.proposals — does NOT execute calendar/email itself
 * (calendar create happens client-side via AddEventForm; execute only marks the proposal done).
 */
export async function POST(req: NextRequest) {
  try {
    const body = (await req.json().catch(() => null)) as {
      id?: string | null;
      action?: string | null;
      proposal_indexes?: unknown;
      proposal_index?: unknown;
      revised_text?: unknown;
      event_id?: unknown;
      dates?: Record<string, string> | null;
    } | null;

    const id = body?.id ? String(body.id) : "";
    const action =
      body?.action === "agree" ||
      body?.action === "dismiss" ||
      body?.action === "undo" ||
      body?.action === "revise" ||
      body?.action === "execute"
        ? body.action
        : null;

    if (!id || !action) {
      return NextResponse.json(
        { success: false, error: "Invalid id or action" },
        { status: 400 }
      );
    }

    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
    }

    const admin = getServiceRoleClient();
    const { data: row, error: fetchError } = await admin
      .from("sage_items")
      .select("id, plan")
      .eq("id", id)
      .eq("visible_to", user.id)
      .maybeSingle();

    if (fetchError) {
      console.error("[sage-inbox/POST] Failed to load sage_item:", fetchError);
      return NextResponse.json({ success: false, error: "Internal server error" }, { status: 500 });
    }

    if (!row) {
      return NextResponse.json({ success: false, error: "Item not found" }, { status: 404 });
    }

    const plan = (
      row.plan && typeof row.plan === "object" ? { ...(row.plan as SagePlan) } : { proposals: [] }
    ) as SagePlan;

    const proposals = Array.isArray(plan.proposals)
      ? plan.proposals.map((p) => ({ ...p }))
      : [];

    if (action === "revise") {
      const idx =
        typeof body?.proposal_index === "number" && Number.isInteger(body.proposal_index)
          ? body.proposal_index
          : -1;
      const revisedText =
        typeof body?.revised_text === "string" ? body.revised_text.trim() : "";
      if (idx < 0 || idx >= proposals.length || !revisedText) {
        return NextResponse.json(
          { success: false, error: "Invalid proposal_index or revised_text" },
          { status: 400 }
        );
      }
      const p = proposals[idx];
      if (!p || (p.type !== "reply_coparent" && p.type !== "ask_clarification")) {
        return NextResponse.json(
          { success: false, error: "Proposal is not revisable" },
          { status: 400 }
        );
      }
      if (p.executed === true) {
        return NextResponse.json(
          { success: false, error: "already sent, cannot revise" },
          { status: 400 }
        );
      }
      proposals[idx] = { ...p, revised_text: revisedText };
      const updatedPlan: SagePlan = { ...plan, proposals };
      const { error: updateError } = await admin
        .from("sage_items")
        .update({ plan: updatedPlan })
        .eq("id", id)
        .eq("visible_to", user.id);
      if (updateError) {
        console.error("[sage-inbox/POST] Failed to save revise:", updateError);
        return NextResponse.json(
          { success: false, error: updateError.message ?? "Failed to save revise" },
          { status: 500 }
        );
      }
      return NextResponse.json({ success: true, plan: updatedPlan });
    }

    if (action === "execute") {
      const idx =
        typeof body?.proposal_index === "number" && Number.isInteger(body.proposal_index)
          ? body.proposal_index
          : -1;
      const eventId =
        typeof body?.event_id === "string" && body.event_id.trim()
          ? body.event_id.trim()
          : "";
      if (idx < 0 || idx >= proposals.length || !eventId) {
        return NextResponse.json(
          { success: false, error: "Invalid proposal_index or event_id" },
          { status: 400 }
        );
      }
      const p = proposals[idx];
      if (!p || p.type !== "calendar_update") {
        return NextResponse.json(
          { success: false, error: "Proposal is not a calendar_update" },
          { status: 400 }
        );
      }
      if (p.executed === true) {
        return NextResponse.json(
          { success: false, error: "already executed" },
          { status: 400 }
        );
      }
      const nowIso = new Date().toISOString();
      proposals[idx] = {
        ...p,
        approved: true,
        approved_at: p.approved_at ?? nowIso,
        executed: true,
        executed_at: nowIso,
        result_event_id: eventId,
      };
      const updatedPlan: SagePlan = { ...plan, proposals };
      const { error: updateError } = await admin
        .from("sage_items")
        .update({ plan: updatedPlan, status: "in_progress" })
        .eq("id", id)
        .eq("visible_to", user.id);
      if (updateError) {
        console.error("[sage-inbox/POST] Failed to save execute:", updateError);
        return NextResponse.json(
          { success: false, error: updateError.message ?? "Failed to mark executed" },
          { status: 500 }
        );
      }
      return NextResponse.json({ success: true, plan: updatedPlan });
    }

    const indexes = Array.isArray(body?.proposal_indexes)
      ? body!.proposal_indexes.filter(
          (n): n is number => typeof n === "number" && Number.isInteger(n) && n >= 0
        )
      : [];
    const dates =
      body?.dates && typeof body.dates === "object" && !Array.isArray(body.dates)
        ? body.dates
        : {};

    if (indexes.length === 0) {
      return NextResponse.json(
        { success: false, error: "Invalid proposal_indexes" },
        { status: 400 }
      );
    }

    const now = new Date().toISOString();
    let waivedAskClarification = false;
    let undidWaivedAskClarification = false;

    for (const idx of indexes) {
      if (idx >= proposals.length) continue;
      const p = proposals[idx];
      if (!p || p.type === "note_only") continue;

      if (action === "undo") {
        if (p.executed === true) {
          return NextResponse.json(
            { success: false, error: "already sent, cannot undo" },
            { status: 400 }
          );
        }
        const wasWaivedAsk =
          p.type === "ask_clarification" && p.status === "waived_by_user";
        const next: PlanProposal = { ...p };
        delete next.approved;
        delete next.approved_at;
        delete next.chosen_date;
        delete next.status;
        delete next.waived_at;
        proposals[idx] = next;
        if (wasWaivedAsk) undidWaivedAskClarification = true;
        continue;
      }

      if (p.executed === true) continue;
      if (p.approved === true || p.status === "waived_by_user") continue;

      const blocked =
        p.depends_on != null &&
        String(p.depends_on).trim() !== "" &&
        p.unblocked !== true;
      if (action === "agree" && blocked) continue;

      if (action === "agree") {
        const chosenDate =
          dates[String(idx)] ?? dates[idx as unknown as string] ?? undefined;
        proposals[idx] = {
          ...p,
          approved: true,
          approved_at: now,
          ...(typeof chosenDate === "string" && chosenDate.trim()
            ? { chosen_date: chosenDate.trim() }
            : {}),
        };
      } else {
        proposals[idx] = {
          ...p,
          status: "waived_by_user",
          waived_at: now,
        };
        if (p.type === "ask_clarification") {
          waivedAskClarification = true;
        }
      }
    }

    // v1 simplification: dismissing ANY ask_clarification proposal sets unblocked = true
    // on all OTHER proposals in that plan that had a non-null depends_on.
    if (waivedAskClarification) {
      for (let i = 0; i < proposals.length; i++) {
        const p = proposals[i];
        if (!p) continue;
        if (p.status === "waived_by_user") continue;
        if (p.depends_on != null && String(p.depends_on).trim() !== "") {
          proposals[i] = { ...p, unblocked: true };
        }
      }
    }

    if (undidWaivedAskClarification) {
      const stillHasWaivedAsk = proposals.some(
        (p) => p.type === "ask_clarification" && p.status === "waived_by_user"
      );
      if (!stillHasWaivedAsk) {
        for (let i = 0; i < proposals.length; i++) {
          const p = proposals[i];
          if (!p) continue;
          if (p.depends_on != null && String(p.depends_on).trim() !== "") {
            const next = { ...p };
            delete next.unblocked;
            proposals[i] = next;
          }
        }
      }
    }

    const updatedPlan: SagePlan = { ...plan, proposals };

    const { error: updateError } = await admin
      .from("sage_items")
      .update({ plan: updatedPlan, status: "in_progress" })
      .eq("id", id)
      .eq("visible_to", user.id);

    if (updateError) {
      console.error("[sage-inbox/POST] Failed to update plan:", updateError);
      return NextResponse.json(
        { success: false, error: updateError.message ?? "Failed to record action" },
        { status: 500 }
      );
    }

    return NextResponse.json({ success: true, plan: updatedPlan });
  } catch (e) {
    console.error("[sage-inbox/POST] Unhandled error:", e);
    return NextResponse.json({ success: false, error: "Internal server error" }, { status: 500 });
  }
}

/**
 * PATCH /api/sage-inbox
 * Body: { id, status?: 'archived'|'pending'|'dismissed', flagged?: boolean }
 * Updates sage_items for an item visible to the current user.
 */
export async function PATCH(req: NextRequest) {
  try {
    const body = (await req.json().catch(() => null)) as
      | { id?: string | null; status?: string | null; flagged?: boolean | null }
      | null;

    const id = body?.id ? String(body.id) : "";
    const status =
      body?.status === "archived" ||
      body?.status === "pending" ||
      body?.status === "dismissed"
        ? body.status
        : null;
    const hasFlagged = typeof body?.flagged === "boolean";
    const flagged = hasFlagged ? body!.flagged : null;

    if (!id || (status === null && !hasFlagged)) {
      return NextResponse.json(
        { success: false, error: "Invalid id or update fields" },
        { status: 400 }
      );
    }

    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
    }

    const updates: { status?: string; flagged?: boolean } = {};
    if (status) updates.status = status;
    if (hasFlagged) updates.flagged = flagged as boolean;

    const admin = getServiceRoleClient();
    const { error: updateError } = await admin
      .from("sage_items")
      .update(updates)
      .eq("id", id)
      .eq("visible_to", user.id);

    if (updateError) {
      console.error("[sage-inbox/PATCH] Failed to update sage_items:", updateError);
      return NextResponse.json(
        { success: false, error: updateError.message ?? "Failed to update" },
        { status: 500 }
      );
    }

    return NextResponse.json({ success: true });
  } catch (e) {
    console.error("[sage-inbox/PATCH] Unhandled error:", e);
    return NextResponse.json({ success: false, error: "Internal server error" }, { status: 500 });
  }
}
