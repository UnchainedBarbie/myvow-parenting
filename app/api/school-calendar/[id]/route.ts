import { NextRequest, NextResponse } from "next/server";
import { createClient, getServiceRoleClient } from "@/lib/supabase/server";

/**
 * PATCH /api/school-calendar/[id]
 * Soft-delete a school calendar (set deleted_at). User must have access to the calendar's case.
 */
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    if (!id) return NextResponse.json({ error: "Missing calendar id" }, { status: 400 });

    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const admin = getServiceRoleClient();
    const { data: calendar } = await admin
      .from("school_calendars")
      .select("id, case_id")
      .eq("id", id)
      .is("deleted_at", null)
      .maybeSingle();
    if (!calendar) return NextResponse.json({ error: "Calendar not found" }, { status: 404 });

    const { data: membership } = await admin
      .from("case_members")
      .select("case_id")
      .eq("case_id", calendar.case_id)
      .eq("user_id", user.id)
      .maybeSingle();
    if (!membership) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

    const { error } = await admin
      .from("school_calendars")
      .update({ deleted_at: new Date().toISOString() })
      .eq("id", id);

    if (error) {
      console.error("[school-calendar PATCH]", error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    return NextResponse.json({ success: true });
  } catch (e) {
    console.error("[school-calendar PATCH]", e);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
