import { NextRequest, NextResponse } from "next/server";
import { createClient, getServiceRoleClient } from "@/lib/supabase/server";

/**
 * GET /api/school-calendar?case_id=...
 * Returns all active school_calendars for the case (deleted_at IS NULL), ordered by uploaded_at DESC.
 */
export async function GET(request: NextRequest) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const { searchParams } = new URL(request.url);
    const case_id = searchParams.get("case_id");
    if (!case_id) {
      return NextResponse.json({ error: "Missing case_id" }, { status: 400 });
    }

    const admin = getServiceRoleClient();
    const { data: membership } = await admin
      .from("case_members")
      .select("case_id")
      .eq("case_id", case_id)
      .eq("user_id", user.id)
      .maybeSingle();
    if (!membership) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

    const { data: calendars, error } = await admin
      .from("school_calendars")
      .select("*")
      .eq("case_id", case_id)
      .is("deleted_at", null)
      .order("uploaded_at", { ascending: false });

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json(calendars ?? []);
  } catch (e) {
    console.error("[school-calendar GET]", e);
    return NextResponse.json({ error: "Failed to load school calendars" }, { status: 500 });
  }
}
