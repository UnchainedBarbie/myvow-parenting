import { NextRequest, NextResponse } from "next/server";
import { createClient, getServiceRoleClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

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
        "id, item_type, domain, summary, evidence_excerpt, urgency, action_required, child_ids, tool_input, status, created_at"
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
