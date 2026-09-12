import { NextRequest, NextResponse } from "next/server";
import { createClient, getServiceRoleClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

type PlanProposal = {
  type?: string;
  draft?: string;
  depends_on?: string | null;
  requires_approval?: boolean;
  approved?: boolean;
  approved_at?: string;
  chosen_date?: string;
  status?: string;
  waived_at?: string;
  unblocked?: boolean;
};

type SagePlan = {
  status?: string;
  proposals?: PlanProposal[];
  reasoning?: string;
  [key: string]: unknown;
};

/**
 * GET /api/sage-inbox
 * Authenticated parent user.
 * Returns sage_items for the user's case that are visible to them and not dismissed.
 */
export async function GET(_req: NextRequest) {
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

    const { data: items, error: itemsError } = await admin
      .from("sage_items")
      .select(
        "id, item_type, domain, summary, evidence_excerpt, urgency, action_required, child_ids, tool_input, plan, status, created_at"
      )
      .eq("case_id", caseId)
      .eq("visible_to", user.id)
      .neq("status", "dismissed")
      .order("created_at", { ascending: false });

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
 * Body: { id, action: "agree" | "dismiss", proposal_indexes: number[], dates?: { [index]: ISO } }
 * Records approval or waiver on plan.proposals — does NOT execute actions.
 */
export async function POST(req: NextRequest) {
  try {
    const body = (await req.json().catch(() => null)) as {
      id?: string | null;
      action?: string | null;
      proposal_indexes?: unknown;
      dates?: Record<string, string> | null;
    } | null;

    const id = body?.id ? String(body.id) : "";
    const action = body?.action === "agree" || body?.action === "dismiss" ? body.action : null;
    const indexes = Array.isArray(body?.proposal_indexes)
      ? body!.proposal_indexes.filter(
          (n): n is number => typeof n === "number" && Number.isInteger(n) && n >= 0
        )
      : [];
    const dates =
      body?.dates && typeof body.dates === "object" && !Array.isArray(body.dates)
        ? body.dates
        : {};

    if (!id || !action || indexes.length === 0) {
      return NextResponse.json(
        { success: false, error: "Invalid id, action, or proposal_indexes" },
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

    const now = new Date().toISOString();
    let waivedAskClarification = false;

    for (const idx of indexes) {
      if (idx >= proposals.length) continue;
      const p = proposals[idx];
      if (!p || p.type === "note_only") continue;
      if (p.approved === true || p.status === "waived_by_user") continue;

      // Blocked proposals cannot be agreed unless already unblocked
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
        // dismiss / waive
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
 * Body: { id, status: 'dismissed' }
 * Updates sage_items.status for an item visible to the current user.
 */
export async function PATCH(req: NextRequest) {
  try {
    const body = (await req.json().catch(() => null)) as
      | { id?: string | null; status?: string | null }
      | null;

    const id = body?.id ? String(body.id) : "";
    const status = body?.status === "dismissed" ? body.status : null;

    if (!id || !status) {
      return NextResponse.json(
        { success: false, error: "Invalid id or status" },
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
    const { error: updateError } = await admin
      .from("sage_items")
      .update({ status })
      .eq("id", id)
      .eq("visible_to", user.id);

    if (updateError) {
      console.error("[sage-inbox/PATCH] Failed to update sage_items.status:", updateError);
      return NextResponse.json(
        { success: false, error: updateError.message ?? "Failed to update status" },
        { status: 500 }
      );
    }

    return NextResponse.json({ success: true });
  } catch (e) {
    console.error("[sage-inbox/PATCH] Unhandled error:", e);
    return NextResponse.json({ success: false, error: "Internal server error" }, { status: 500 });
  }
}
