import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getServiceRoleClient } from "@/lib/supabase/server";

/**
 * GET /api/cases/settings — get current user's case settings (app_mode, message_delay_minutes, ai_moderation_level).
 * PATCH /api/cases/settings — update current user's case settings.
 */
export async function GET() {
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
    if (!membership?.case_id) return NextResponse.json({ app_mode: null, message_delay_minutes: null, ai_moderation_level: null, case_id: null });

    const { data: caseRow, error } = await admin
      .from("cases")
      .select("id, app_mode, message_delay_minutes, ai_moderation_level")
      .eq("id", membership.case_id)
      .single();
    if (error || !caseRow) return NextResponse.json({ app_mode: null, message_delay_minutes: null, ai_moderation_level: null, case_id: null });

    return NextResponse.json({
      case_id: caseRow.id,
      app_mode: (caseRow as { app_mode?: string | null }).app_mode ?? "partner",
      message_delay_minutes: (caseRow as { message_delay_minutes?: number | null }).message_delay_minutes ?? 0,
      ai_moderation_level: (caseRow as { ai_moderation_level?: string | null }).ai_moderation_level ?? "standard",
    });
  } catch (e) {
    console.error("[cases/settings GET]", e);
    return NextResponse.json({ error: "Failed to load settings" }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest) {
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
    const updates: Record<string, unknown> = {};
    if (body.app_mode !== undefined) {
      const v = String(body.app_mode).toLowerCase();
      if (["solo", "partner", "coparenting"].includes(v)) updates.app_mode = v;
    }
    if (body.message_delay_minutes !== undefined) {
      const n = Number(body.message_delay_minutes);
      if (Number.isInteger(n) && n >= 0) updates.message_delay_minutes = n;
    }
    if (body.ai_moderation_level !== undefined) {
      const v = String(body.ai_moderation_level).toLowerCase();
      if (["off", "standard", "high"].includes(v)) updates.ai_moderation_level = v;
    }
    if (Object.keys(updates).length === 0) return NextResponse.json({ error: "No valid fields to update" }, { status: 400 });

    const { error: updateErr } = await admin
      .from("cases")
      .update(updates)
      .eq("id", membership.case_id);
    if (updateErr) return NextResponse.json({ error: updateErr.message }, { status: 500 });

    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error("[cases/settings PATCH]", e);
    return NextResponse.json({ error: "Failed to update settings" }, { status: 500 });
  }
}
