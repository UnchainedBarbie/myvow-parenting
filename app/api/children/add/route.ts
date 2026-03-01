import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getServiceRoleClient } from "@/lib/supabase/server";

/**
 * POST /api/children/add
 * Body: { first_name: string; date_of_birth?: string | null }
 * Creates a child for the authenticated user's case.
 */
export async function POST(req: NextRequest) {
  try {
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
    const first_name = typeof body.first_name === "string" ? body.first_name.trim() : "";
    if (!first_name) return NextResponse.json({ error: "First name is required" }, { status: 400 });
    const date_of_birth =
      body.date_of_birth == null || body.date_of_birth === ""
        ? null
        : String(body.date_of_birth).slice(0, 10);

    const { data: row, error } = await admin
      .from("children")
      .insert({
        case_id: membership.case_id,
        first_name,
        date_of_birth: date_of_birth || null,
      })
      .select("id, first_name, date_of_birth")
      .single();

    if (error) {
      console.error("[children/add] Supabase error:", error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json(row);
  } catch (e) {
    console.error("[children/add] Error:", e);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
