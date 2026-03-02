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
    if (!membership?.case_id) return NextResponse.json({ app_mode: null, mode: null, message_delay_minutes: null, ai_moderation_level: null, case_id: null, messaging_window_start: null, messaging_window_end: null, quiet_hours_enabled: false });

    const { data: caseRow, error } = await admin
      .from("cases")
      .select("id, mode, app_mode, message_delay_minutes, ai_moderation_level, messaging_window_start, messaging_window_end, quiet_hours_enabled")
      .eq("id", membership.case_id)
      .single();
    if (error || !caseRow) return NextResponse.json({ app_mode: null, mode: null, message_delay_minutes: null, ai_moderation_level: null, case_id: null, messaging_window_start: null, messaging_window_end: null, quiet_hours_enabled: false });

    const row = caseRow as Record<string, unknown>;
    const fmtTime = (v: unknown) => (typeof v === "string" ? v.slice(0, 5) : null); // "HH:mm"
    const modeVal = (row.mode as string) ?? (row.app_mode as string) ?? "partner";
    return NextResponse.json({
      case_id: caseRow.id,
      app_mode: modeVal,
      mode: modeVal,
      message_delay_minutes: Number(row.message_delay_minutes) ?? 0,
      ai_moderation_level: (row.ai_moderation_level as string) ?? "standard",
      messaging_window_start: fmtTime(row.messaging_window_start),
      messaging_window_end: fmtTime(row.messaging_window_end),
      quiet_hours_enabled: !!row.quiet_hours_enabled,
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
    const modeVal = body.mode !== undefined ? body.mode : body.app_mode;
    if (modeVal !== undefined) {
      const v = String(modeVal).toLowerCase();
      if (["solo", "partner", "coparenting", "solo_coparenting"].includes(v)) {
        updates.mode = v;
        if (v !== "solo_coparenting") updates.app_mode = v; // app_mode CHECK only allows solo, partner, coparenting
      }
    }
    if (body.message_delay_minutes !== undefined) {
      const n = Number(body.message_delay_minutes);
      if (Number.isInteger(n) && n >= 0) updates.message_delay_minutes = n;
    }
    if (body.ai_moderation_level !== undefined) {
      const v = String(body.ai_moderation_level).toLowerCase();
      if (["off", "standard", "high"].includes(v)) updates.ai_moderation_level = v;
    }
    if (body.messaging_window_start !== undefined) {
      const v = body.messaging_window_start == null || body.messaging_window_start === "" ? null : String(body.messaging_window_start).slice(0, 5);
      updates.messaging_window_start = v && /^\d{1,2}:\d{2}$/.test(v) ? `${v}:00` : null;
    }
    if (body.messaging_window_end !== undefined) {
      const v = body.messaging_window_end == null || body.messaging_window_end === "" ? null : String(body.messaging_window_end).slice(0, 5);
      updates.messaging_window_end = v && /^\d{1,2}:\d{2}$/.test(v) ? `${v}:00` : null;
    }
    if (body.quiet_hours_enabled !== undefined) updates.quiet_hours_enabled = !!body.quiet_hours_enabled;
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
