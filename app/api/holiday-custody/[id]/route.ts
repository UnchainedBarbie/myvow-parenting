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

async function getHolidayAndCheckAccess(
  admin: ReturnType<typeof getServiceRoleClient>,
  id: string,
  caseId: string
) {
  const { data, error } = await admin
    .from("holiday_custody")
    .select("id, case_id")
    .eq("id", id)
    .is("deleted_at", null)
    .maybeSingle();
  if (error || !data) return null;
  if ((data.case_id as string) !== caseId) return null;
  return data;
}

/**
 * PATCH /api/holiday-custody/[id] — update holiday_custody by id.
 * Body: { holiday_name?, custodial_parent?, odd_year_parent?, even_year_parent?, start_date?, end_date?, notes?, is_relative? }
 */
export async function PATCH(
  req: NextRequest,
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

    const existing = await getHolidayAndCheckAccess(admin, id, caseId);
    if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 });

    const body = (await req.json().catch(() => ({}))) as {
      holiday_name?: string;
      custodial_parent?: string;
      odd_year_parent?: string;
      even_year_parent?: string;
      start_date?: string | null;
      end_date?: string | null;
      notes?: string | null;
      is_relative?: boolean;
    };

    const updates: Record<string, unknown> = {};
    if (body.holiday_name !== undefined) updates.holiday_name = typeof body.holiday_name === "string" ? body.holiday_name.trim() : "";
    if (body.custodial_parent !== undefined) {
      const v = body.custodial_parent;
      if (v === "user" || v === "coparent" || v === "alternating") updates.custodial_parent = v;
    }
    if (body.odd_year_parent !== undefined) {
      const v = body.odd_year_parent;
      updates.odd_year_parent = v === "user" || v === "coparent" ? v : null;
    }
    if (body.even_year_parent !== undefined) {
      const v = body.even_year_parent;
      updates.even_year_parent = v === "user" || v === "coparent" ? v : null;
    }
    if (body.start_date !== undefined) updates.start_date = body.start_date == null || body.start_date === "" ? null : String(body.start_date).slice(0, 10);
    if (body.end_date !== undefined) updates.end_date = body.end_date == null || body.end_date === "" ? null : String(body.end_date).slice(0, 10);
    if (body.notes !== undefined) updates.notes = body.notes == null || body.notes === "" ? null : String(body.notes).trim();
    if (body.is_relative !== undefined) updates.is_relative = Boolean(body.is_relative);

    if (Object.keys(updates).length === 0) {
      return NextResponse.json({ error: "No fields to update" }, { status: 400 });
    }

    const { data: row, error } = await admin
      .from("holiday_custody")
      .update(updates)
      .eq("id", id)
      .select()
      .single();

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json(row);
  } catch (e) {
    console.error("[holiday-custody/[id] PATCH]", e);
    return NextResponse.json({ error: "Failed to update holiday" }, { status: 500 });
  }
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

    const existing = await getHolidayAndCheckAccess(admin, id, caseId);
    if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 });

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
