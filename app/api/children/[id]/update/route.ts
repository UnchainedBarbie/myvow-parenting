import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getServiceRoleClient } from "@/lib/supabase/server";

/**
 * POST /api/children/[id]/update
 * PATCH /api/children/[id] — same body, for kid_sage_tone etc.
 * Body: { first_name?, date_of_birth?, grade_level?, member_status?, invited_email?, invited_phone?, kid_sage_tone?, school_calendar_id? }
 * Updates a child. User must belong to the child's case.
 */
async function updateChild(
  req: NextRequest,
  id: string
): Promise<NextResponse> {
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
  const member_status = body.member_status === "invited" || body.member_status === "active" || body.member_status === "not_invited" ? body.member_status : undefined;
  const invited_email = body.invited_email !== undefined ? (body.invited_email == null || body.invited_email === "" ? null : String(body.invited_email).trim()) : undefined;
  const invited_phone = body.invited_phone !== undefined ? (body.invited_phone == null || body.invited_phone === "" ? null : String(body.invited_phone).trim()) : undefined;
  const kid_sage_tone = body.kid_sage_tone === "younger" || body.kid_sage_tone === "default" || body.kid_sage_tone === "older" ? body.kid_sage_tone : undefined;
  const grade_level = body.grade_level !== undefined
    ? (body.grade_level == null || body.grade_level === "" ? null : String(body.grade_level).trim())
    : undefined;
  const school_calendar_id = body.school_calendar_id !== undefined
    ? (body.school_calendar_id == null || body.school_calendar_id === "" ? null : String(body.school_calendar_id).trim())
    : undefined;

  const updatePayload: { first_name?: string; date_of_birth?: string | null; grade_level?: string | null; member_status?: string; invited_email?: string | null; invited_phone?: string | null; kid_sage_tone?: string; school_calendar_id?: string | null } = {};
  if (first_name !== undefined) updatePayload.first_name = first_name;
  if (date_of_birth !== undefined) updatePayload.date_of_birth = date_of_birth;
  if (grade_level !== undefined) updatePayload.grade_level = grade_level;
  if (member_status !== undefined) updatePayload.member_status = member_status;
  if (invited_email !== undefined) updatePayload.invited_email = invited_email;
  if (invited_phone !== undefined) updatePayload.invited_phone = invited_phone;
  if (kid_sage_tone !== undefined) updatePayload.kid_sage_tone = kid_sage_tone;
  if (school_calendar_id !== undefined) updatePayload.school_calendar_id = school_calendar_id;
  if (Object.keys(updatePayload).length === 0) {
    return NextResponse.json({ error: "No fields to update" }, { status: 400 });
  }
  if (updatePayload.first_name !== undefined && !updatePayload.first_name) {
    return NextResponse.json({ error: "First name cannot be empty" }, { status: 400 });
  }
  if (updatePayload.member_status === "invited") {
    const hasContact = (updatePayload.invited_email != null && updatePayload.invited_email !== "") || (updatePayload.invited_phone != null && updatePayload.invited_phone !== "");
    if (!hasContact) return NextResponse.json({ error: "Email or phone required to send invite" }, { status: 400 });
  }

  const { data: row, error } = await admin
    .from("children")
    .update(updatePayload)
    .eq("id", id)
    .eq("case_id", membership.case_id)
    .is("deleted_at", null)
    .select("id, first_name, date_of_birth, grade_level, member_status, invited_email, invited_phone, kid_sage_tone, school_calendar_id")
    .single();

  if (error) {
    console.error("[children/update] Supabase error:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  if (!row) return NextResponse.json({ error: "Child not found" }, { status: 404 });

  return NextResponse.json(row);
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    if (!id) return NextResponse.json({ error: "Missing child id" }, { status: 400 });
    return updateChild(req, id);
  } catch (e) {
    console.error("[children/update] Error:", e);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    if (!id) return NextResponse.json({ error: "Missing child id" }, { status: 400 });
    return updateChild(req, id);
  } catch (e) {
    console.error("[children/update] Error:", e);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
