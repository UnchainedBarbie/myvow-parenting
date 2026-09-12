import { NextRequest, NextResponse } from "next/server";
import { createClient, getServiceRoleClient } from "@/lib/supabase/server";
import { redraftMessage } from "@/lib/sage/planner";

export const runtime = "nodejs";

/**
 * POST /api/sage-inbox/redraft
 * Body: { id, proposal_index, guidance }
 * Returns a redrafted message — does NOT persist (Save uses action "revise").
 */
export async function POST(req: NextRequest) {
  try {
    const body = (await req.json().catch(() => null)) as {
      id?: string | null;
      proposal_index?: unknown;
      guidance?: unknown;
    } | null;

    const id = body?.id ? String(body.id) : "";
    const idx =
      typeof body?.proposal_index === "number" && Number.isInteger(body.proposal_index)
        ? body.proposal_index
        : -1;
    const guidance = typeof body?.guidance === "string" ? body.guidance : "";

    if (!id || idx < 0) {
      return NextResponse.json(
        { success: false, error: "Invalid id or proposal_index" },
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
      .select("id, summary, plan")
      .eq("id", id)
      .eq("visible_to", user.id)
      .maybeSingle();

    if (fetchError) {
      console.error("[sage-inbox/redraft] Failed to load sage_item:", fetchError);
      return NextResponse.json({ success: false, error: "Internal server error" }, { status: 500 });
    }

    if (!row) {
      return NextResponse.json({ success: false, error: "Item not found" }, { status: 404 });
    }

    const plan =
      row.plan && typeof row.plan === "object"
        ? (row.plan as { proposals?: Array<{ type?: string; draft?: string; revised_text?: string }> })
        : null;
    const proposals = Array.isArray(plan?.proposals) ? plan!.proposals! : [];
    const proposal = proposals[idx];
    if (
      !proposal ||
      (proposal.type !== "reply_coparent" && proposal.type !== "ask_clarification")
    ) {
      return NextResponse.json(
        { success: false, error: "Proposal is not redraftable" },
        { status: 400 }
      );
    }

    const currentDraft =
      (typeof proposal.revised_text === "string" && proposal.revised_text.trim()
        ? proposal.revised_text
        : proposal.draft) ?? "";

    const draft = await redraftMessage({
      summary: (row.summary as string | null) ?? "",
      proposalType: proposal.type as "reply_coparent" | "ask_clarification",
      currentDraft,
      guidance,
    });

    if (!draft) {
      return NextResponse.json(
        { success: false, error: "Redraft failed" },
        { status: 502 }
      );
    }

    return NextResponse.json({ success: true, draft });
  } catch (e) {
    console.error("[sage-inbox/redraft] Unhandled error:", e);
    return NextResponse.json({ success: false, error: "Internal server error" }, { status: 500 });
  }
}
