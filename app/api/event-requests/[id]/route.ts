import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getServiceRoleClient } from "@/lib/supabase/server";

/**
 * PATCH /api/event-requests/[id] — approve or decline an event request. Parent auth.
 * Body: { status: 'approved' | 'declined' }
 * If approved: creates a calendar_event with visibility='family' and sets approved_event_id.
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const { id } = await params;
    if (!id) return NextResponse.json({ error: "Missing id" }, { status: 400 });

    const body = await request.json().catch(() => ({})) as { status?: string };
    const status = body.status === "approved" ? "approved" : body.status === "declined" ? "declined" : null;
    if (!status) return NextResponse.json({ error: "status must be 'approved' or 'declined'" }, { status: 400 });

    const admin = getServiceRoleClient();
    const { data: membership } = await admin
      .from("case_members")
      .select("case_id")
      .eq("user_id", user.id)
      .limit(1)
      .maybeSingle();
    if (!membership?.case_id) return NextResponse.json({ error: "No case found" }, { status: 403 });

    const { data: reqRow, error: fetchErr } = await admin
      .from("event_requests")
      .select("id, case_id, requested_by_child_id, requested_date, requested_time, title, notes")
      .eq("id", id)
      .eq("case_id", membership.case_id)
      .is("deleted_at", null)
      .maybeSingle();

    if (fetchErr || !reqRow) return NextResponse.json({ error: "Request not found" }, { status: 404 });

    const now = new Date().toISOString();
    if (status === "declined") {
      const { error: updateErr } = await admin
        .from("event_requests")
        .update({ status: "declined", updated_at: now, deleted_at: now })
        .eq("id", id);
      if (updateErr) return NextResponse.json({ error: updateErr.message }, { status: 500 });
      return NextResponse.json({ ok: true });
    }

    const requested_date = reqRow.requested_date as string;
    const requested_time = (reqRow.requested_time as string | null) ?? null;
    const title = (reqRow.title as string) ?? "";
    const notes = (reqRow.notes as string | null) ?? null;
    const dateStr = requested_date.slice(0, 10);
    const timePart = requested_time
      ? (requested_time.length >= 8 ? requested_time.slice(0, 8) : requested_time.slice(0, 5) + ":00")
      : "12:00:00";
    const start_time = `${dateStr}T${timePart}`;

    const { data: newEvent, error: insertErr } = await admin
      .from("calendar_events")
      .insert({
        case_id: reqRow.case_id,
        created_by: user.id,
        title,
        description: notes,
        event_type: "extracurricular",
        child_id: reqRow.requested_by_child_id ?? null,
        start_time,
        end_time: null,
        all_day: !requested_time,
        visibility: "family",
        kid_title: title,
      })
      .select("id")
      .single();

    if (insertErr) return NextResponse.json({ error: insertErr.message ?? "Failed to create event" }, { status: 500 });

    const { error: updateErr } = await admin
      .from("event_requests")
      .update({
        status: "approved",
        approved_event_id: newEvent.id,
        updated_at: now,
      })
      .eq("id", id);
    if (updateErr) return NextResponse.json({ error: updateErr.message }, { status: 500 });

    return NextResponse.json({ success: true, event_id: newEvent.id });
  } catch (e) {
    console.error("[event-requests PATCH]", e);
    return NextResponse.json({ error: "Failed to update request" }, { status: 500 });
  }
}
