import { NextRequest, NextResponse } from "next/server";
import { createClient, getServiceRoleClient } from "@/lib/supabase/server";

async function getCaseIdForUser(admin: ReturnType<typeof getServiceRoleClient>, userId: string) {
  const { data: membership } = await admin
    .from("case_members")
    .select("case_id")
    .eq("user_id", userId)
    .limit(1)
    .maybeSingle();
  return membership?.case_id ?? null;
}

/**
 * DELETE /api/holiday-custody/[id] — soft delete: SET deleted_at = now() WHERE id = [id].
 */
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const admin = getServiceRoleClient();
    const caseId = await getCaseIdForUser(admin, user.id);
    if (!caseId) return NextResponse.json({ error: "No case found" }, { status: 403 });

    const { id } = await params;
    if (!id) return NextResponse.json({ error: "Missing id" }, { status: 400 });

    const { data: existing, error: fetchError } = await admin
      .from("holiday_custody")
      .select("id, case_id")
      .eq("id", id)
      .maybeSingle();

    if (fetchError || !existing) return NextResponse.json({ error: "Not found" }, { status: 404 });
    if ((existing.case_id as string) !== caseId) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

    const { error } = await admin
      .from("holiday_custody")
      .update({ deleted_at: new Date().toISOString() })
      .eq("id", id);

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error("[holiday-custody/[id] DELETE]", e);
    return NextResponse.json({ error: "Failed to delete holiday custody" }, { status: 500 });
  }
}
