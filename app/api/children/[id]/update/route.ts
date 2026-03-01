import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getServiceRoleClient } from "@/lib/supabase/server";

/**
 * POST /api/children/[id]/update
 * Body: { first_name?: string; date_of_birth?: string | null }
 * Updates a child. User must belong to the child's case.
 */
export async function POST(
  req: NextRequest,
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

    const body = await req.json().catch(() => ({}));
    const first_name = body.first_name !== undefined
      ? (typeof body.first_name === "string" ? body.first_name.trim() : "")
      : undefined;
    const date_of_birth =
      body.date_of_birth !== undefined
        ? (body.date_of_birth == null || body.date_of_birth === ""
            ? null
            : String(body.date_of_birth).slice(0, 10))
        : undefined;

    const updatePayload: { first_name?: string; date_of_birth?: string | null } = {};
    if (first_name !== undefined) updatePayload.first_name = first_name;
    if (date_of_birth !== undefined) updatePayload.date_of_birth = date_of_birth;
    if (Object.keys(updatePayload).length === 0) {
      return NextResponse.json({ error: "No fields to update" }, { status: 400 });
    }
    if (updatePayload.first_name !== undefined && !updatePayload.first_name) {
      return NextResponse.json({ error: "First name cannot be empty" }, { status: 400 });
    }

    const { data: row, error } = await admin
      .from("children")
      .update(updatePayload)
      .eq("id", id)
      .eq("case_id", membership.case_id)
      .is("deleted_at", null)
      .select("id, first_name, date_of_birth")
      .single();

    if (error) {
      console.error("[children/update] Supabase error:", error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    if (!row) return NextResponse.json({ error: "Child not found" }, { status: 404 });

    return NextResponse.json(row);
  } catch (e) {
    console.error("[children/update] Error:", e);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
