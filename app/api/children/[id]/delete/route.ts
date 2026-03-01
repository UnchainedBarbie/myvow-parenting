import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getServiceRoleClient } from "@/lib/supabase/server";

/**
 * POST /api/children/[id]/delete
 * Soft deletes a child (sets deleted_at). User must belong to the child's case.
 */
export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    if (!id) return NextResponse.json({ error: "Missing child id" }, { status: 400 });

    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const admin = getServiceRoleClient();
    const { data: membership } = await admin
      .from("case_members")
      .select("case_id")
      .eq("user_id", user.id)
      .limit(1)
      .maybeSingle();
    if (!membership?.case_id) return NextResponse.json({ error: "No case found" }, { status: 403 });

    const { data: row, error } = await admin
      .from("children")
      .update({ deleted_at: new Date().toISOString() })
      .eq("id", id)
      .eq("case_id", membership.case_id)
      .is("deleted_at", null)
      .select("id")
      .single();

    if (error) {
      console.error("[children/delete] Supabase error:", error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    if (!row) return NextResponse.json({ error: "Child not found" }, { status: 404 });

    return NextResponse.json({ success: true });
  } catch (e) {
    console.error("[children/delete] Error:", e);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
