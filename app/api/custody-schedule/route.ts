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
 * GET /api/custody-schedule — fetch the most recently updated custody_schedules row for the current user's case_id.
 * Equivalent to: SELECT ... FROM custody_schedules WHERE case_id = ? ORDER BY updated_at DESC LIMIT 1
 */
export async function GET() {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const admin = getServiceRoleClient();
    const caseId = await getCaseIdForUser(admin, user.id);
    if (!caseId) return NextResponse.json({ error: "No case found" }, { status: 403 });

    const { data, error } = await admin
      .from("custody_schedules")
      .select("id, case_id, schedule_type, rotation_start_date, user_starts_first, manual_pattern")
      .eq("case_id", caseId)
      .order("updated_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    console.log("[custody-schedule GET] returning:", JSON.stringify(data));
    return NextResponse.json(data, {
      headers: {
        "Cache-Control": "no-store, no-cache, must-revalidate",
        Pragma: "no-cache",
      },
    });
  } catch (e) {
    console.error("[custody-schedule GET]", e);
    return NextResponse.json({ error: "Failed to load custody schedule" }, { status: 500 });
  }
}

/**
 * POST /api/custody-schedule — create or update a custody_schedules row for the case.
 * Selects existing row (deleted_at IS NULL); if found, updates it; otherwise inserts.
 */
export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => ({}))) as {
    schedule_type?: string;
    rotation_start_date?: string | null;
    user_starts_first?: boolean | null;
    manual_pattern?: (string | null)[] | null;
  };
  console.log("[custody-schedule POST] body:", JSON.stringify(body));

  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const admin = getServiceRoleClient();
    const caseId = await getCaseIdForUser(admin, user.id);
    if (!caseId) return NextResponse.json({ error: "No case found" }, { status: 403 });

    const schedule_type = body.schedule_type ?? "week_on_week_off";
    const user_starts_first = body.user_starts_first ?? null;
    const manual_pattern = Array.isArray(body.manual_pattern) && body.manual_pattern.length === 14
      ? body.manual_pattern
      : null;

    const { data: existing, error: selectError } = await admin
      .from("custody_schedules")
      .select("id, rotation_start_date, manual_pattern")
      .eq("case_id", caseId)
      .is("deleted_at", null)
      .limit(1)
      .maybeSingle();

    if (selectError) return NextResponse.json({ error: selectError.message }, { status: 500 });

    const now = new Date().toISOString();

    if (existing?.id) {
      const { data: row, error: updateError } = await admin
        .from("custody_schedules")
        .update({
          schedule_type,
          rotation_start_date: body.rotation_start_date ?? null,
          user_starts_first,
          manual_pattern: manual_pattern ?? null,
          updated_at: now,
        })
        .eq("id", existing.id)
        .select("id, case_id, schedule_type, rotation_start_date, user_starts_first, manual_pattern")
        .single();

      if (updateError) return NextResponse.json({ error: updateError.message }, { status: 500 });
      if (schedule_type !== "manual") {
        await admin.from("custody_day_overrides").delete().eq("case_id", caseId);
      }
      return NextResponse.json(row);
    }

    const { data: row, error: insertError } = await admin
      .from("custody_schedules")
      .insert({
        case_id: caseId,
        schedule_type,
        rotation_start_date: body.rotation_start_date ?? null,
        user_starts_first,
        manual_pattern: manual_pattern ?? null,
      })
      .select("id, case_id, schedule_type, rotation_start_date, user_starts_first, manual_pattern")
      .single();

    if (insertError) return NextResponse.json({ error: insertError.message }, { status: 500 });
    if (schedule_type !== "manual") {
      await admin.from("custody_day_overrides").delete().eq("case_id", caseId);
    }
    return NextResponse.json(row);
  } catch (e) {
    console.error("[custody-schedule POST]", e);
    return NextResponse.json({ error: "Failed to save custody schedule" }, { status: 500 });
  }
}
