import { NextRequest, NextResponse } from "next/server";
import { createClient, getServiceRoleClient } from "@/lib/supabase/server";

const BOOLEAN_FIELDS = [
  "proactive_sage_enabled",
  "proactive_sage_incoming_enabled",
  "proactive_sage_drafts_enabled",
  "structured_pause_enabled",
  "cool_off_enabled",
  "sage_message_review",
  "vow_references",
  "send_read_receipts",
  "delivery_window_enabled",
] as const;

const FIELDS = [...BOOLEAN_FIELDS, "default_pause_duration", "delivery_start_time", "delivery_end_time"] as const;
const DEFAULT_PAUSE_VALUES = new Set(["30min", "2hours", "until_tomorrow"]);

export async function GET() {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const admin = getServiceRoleClient();
    const { data: row } = await admin
      .from("user_settings")
      .select("*")
      .eq("user_id", user.id)
      .maybeSingle();

    const defaults = {
      proactive_sage_enabled: true,
      proactive_sage_incoming_enabled: true,
      proactive_sage_drafts_enabled: true,
      structured_pause_enabled: true,
      cool_off_enabled: true,
      sage_message_review: true,
      vow_references: true,
      default_pause_duration: "2hours" as const,
      send_read_receipts: false,
      delivery_window_enabled: false,
      delivery_start_time: null as string | null,
      delivery_end_time: null as string | null,
    };

    if (row) {
      return NextResponse.json({
        ...defaults,
        proactive_sage_enabled: row.proactive_sage_enabled ?? true,
        proactive_sage_incoming_enabled: row.proactive_sage_incoming_enabled ?? true,
        proactive_sage_drafts_enabled: row.proactive_sage_drafts_enabled ?? true,
        structured_pause_enabled: row.structured_pause_enabled ?? true,
        cool_off_enabled: row.cool_off_enabled ?? true,
        sage_message_review: row.sage_message_review ?? true,
        vow_references: row.vow_references ?? true,
        default_pause_duration: DEFAULT_PAUSE_VALUES.has(row.default_pause_duration as string) ? row.default_pause_duration : "2hours",
        send_read_receipts: row.send_read_receipts ?? false,
        delivery_window_enabled: row.delivery_window_enabled ?? false,
        delivery_start_time: (row.delivery_start_time as string | null) ?? null,
        delivery_end_time: (row.delivery_end_time as string | null) ?? null,
      });
    }

    return NextResponse.json(defaults);
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Failed to load settings" },
      { status: 500 }
    );
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await request.json().catch(() => ({}));
    const admin = getServiceRoleClient();

    const { data: existing } = await admin
      .from("user_settings")
      .select("*")
      .eq("user_id", user.id)
      .maybeSingle();

    const updates: Record<string, boolean | string> = {};
    for (const field of BOOLEAN_FIELDS) {
      if (typeof body[field] === "boolean") {
        updates[field] = body[field];
      }
    }
    if (typeof body.default_pause_duration === "string" && DEFAULT_PAUSE_VALUES.has(body.default_pause_duration)) {
      updates.default_pause_duration = body.default_pause_duration;
    }
    if (typeof body.delivery_start_time === "string") {
      updates.delivery_start_time = body.delivery_start_time;
    }
    if (typeof body.delivery_end_time === "string") {
      updates.delivery_end_time = body.delivery_end_time;
    }

    if (Object.keys(updates).length === 0) {
      return NextResponse.json({ error: "No valid fields to update" }, { status: 400 });
    }

    const previous = (existing ?? {}) as Record<string, unknown>;
    for (const [field, newVal] of Object.entries(updates)) {
      const oldVal = previous[field];
      if (oldVal === newVal) continue;
      await admin.from("edit_history").insert({
        user_id: user.id,
        scope: "global",
        conversation_id: null,
        field,
        old_value: oldVal != null ? oldVal : null,
        new_value: newVal,
      });
    }

    const { data: updated, error } = await admin
      .from("user_settings")
      .upsert(
        {
          user_id: user.id,
          ...updates,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "user_id" }
      )
      .select()
      .single();

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    const out = {
      proactive_sage_enabled: updated.proactive_sage_enabled ?? true,
      proactive_sage_incoming_enabled: updated.proactive_sage_incoming_enabled ?? true,
      proactive_sage_drafts_enabled: updated.proactive_sage_drafts_enabled ?? true,
      structured_pause_enabled: updated.structured_pause_enabled ?? true,
      cool_off_enabled: updated.cool_off_enabled ?? true,
      sage_message_review: updated.sage_message_review ?? true,
      vow_references: updated.vow_references ?? true,
      default_pause_duration: DEFAULT_PAUSE_VALUES.has(updated.default_pause_duration as string) ? updated.default_pause_duration : "2hours",
      send_read_receipts: updated.send_read_receipts ?? false,
      delivery_window_enabled: updated.delivery_window_enabled ?? false,
      delivery_start_time: (updated.delivery_start_time as string | null) ?? null,
      delivery_end_time: (updated.delivery_end_time as string | null) ?? null,
    };
    return NextResponse.json(out);
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Failed to update settings" },
      { status: 500 }
    );
  }
}
