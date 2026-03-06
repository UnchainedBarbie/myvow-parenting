import { NextRequest, NextResponse } from "next/server";
import { createClient, getServiceRoleClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

/**
 * GET /api/inbox
 * Authenticated parent user.
 * Returns up to 20 pending inbox_items for the user's case, ordered by created_at desc.
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
      console.error("[inbox/GET] Error loading membership:", membershipError);
      return NextResponse.json({ error: "Internal server error" }, { status: 500 });
    }

    if (!membership?.case_id) {
      return NextResponse.json({ error: "No case found" }, { status: 403 });
    }

    const caseId = membership.case_id as string;

    const { data: items, error: itemsError } = await admin
      .from("inbox_items")
      .select("*")
      .eq("case_id", caseId)
      .eq("status", "pending")
      .order("created_at", { ascending: false })
      .limit(20);

    if (itemsError) {
      console.error("[inbox/GET] Error loading inbox_items:", itemsError);
      return NextResponse.json({ error: "Failed to load inbox items" }, { status: 500 });
    }

    return NextResponse.json(items ?? []);
  } catch (e) {
    console.error("[inbox/GET] Unhandled error:", e);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

/**
 * PATCH /api/inbox
 * Body: { id, status: 'accepted' | 'dismissed' }
 * Updates inbox_items.status for the current user's case.
 */
export async function PATCH(req: NextRequest) {
  try {
    const body = (await req.json().catch(() => null)) as
      | { id?: string | null; status?: string | null }
      | null;

    const id = body?.id ? String(body.id) : "";
    const status = body?.status === "accepted" || body?.status === "dismissed" ? body.status : null;

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
    const { data: membership, error: membershipError } = await admin
      .from("case_members")
      .select("case_id")
      .eq("user_id", user.id)
      .limit(1)
      .maybeSingle();

    if (membershipError) {
      console.error("[inbox/PATCH] Error loading membership:", membershipError);
      return NextResponse.json({ success: false, error: "Internal server error" }, { status: 500 });
    }

    if (!membership?.case_id) {
      return NextResponse.json({ success: false, error: "No case found" }, { status: 403 });
    }

    const caseId = membership.case_id as string;

    const { error: updateError } = await admin
      .from("inbox_items")
      .update({ status })
      .eq("id", id)
      .eq("case_id", caseId);

    if (updateError) {
      console.error("[inbox/PATCH] Failed to update inbox_items.status:", updateError);
      return NextResponse.json(
        { success: false, error: updateError.message ?? "Failed to update status" },
        { status: 500 }
      );
    }

    return NextResponse.json({ success: true });
  } catch (e) {
    console.error("[inbox/PATCH] Unhandled error:", e);
    return NextResponse.json({ success: false, error: "Internal server error" }, { status: 500 });
  }
}

