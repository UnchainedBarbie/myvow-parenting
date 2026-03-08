import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getServiceRoleClient } from "@/lib/supabase/server";

/** POST /api/calendar/inbox/[id]/create-event — create event from needs_review inbox message. */
export async function POST(
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const { id: messageId } = await context.params;
    if (!messageId) return NextResponse.json({ error: "Missing message id" }, { status: 400 });

    const admin = getServiceRoleClient();
    const { data: msg, error: fetchErr } = await admin
      .from("calendar_inbox_messages")
      .select("*")
      .eq("id", messageId)
      .eq("user_id", user.id)
      .single();

    if (fetchErr || !msg) return NextResponse.json({ error: "Message not found" }, { status: 404 });
    const m = msg as any;
    if (m.created_event_id) return NextResponse.json({ error: "Event already created" }, { status: 400 });
    if (m.parse_status !== "needs_review" && m.parse_status !== "parsed") return NextResponse.json({ error: "Cannot create event from this message" }, { status: 400 });

    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    const title = (body.title as string) ?? m.parsed_title ?? "Untitled";
    const dateStr = (body.date as string) ?? (m.parsed_date ? String(m.parsed_date).slice(0, 10) : null) ?? new Date().toISOString().slice(0, 10);
    const startTime = (body.start_time as string) ?? (m.parsed_start_time ? new Date(m.parsed_start_time).toTimeString().slice(0, 5) : "09:00");
    const endTime = (body.end_time as string) ?? (m.parsed_end_time ? new Date(m.parsed_end_time).toTimeString().slice(0, 5) : null);
    const startIso = new Date(`${dateStr}T${startTime}:00`).toISOString();
    const endIso = endTime ? new Date(`${dateStr}T${endTime}:00`).toISOString() : null;
    const eventType = (body.event_type as string) ?? m.parsed_category ?? "other";
    const childId = (body.child_id as string) ?? m.parsed_child_id ?? null;
    const visibility = (body.visibility as "family" | "parents_only" | "just_me_and_kids" | "private") ?? m.parsed_visibility ?? "family";
    const description = (body.description as string) ?? m.parsed_notes ?? m.body_text?.slice(0, 2000) ?? null;
    const caption = `Captured via ${m.source} from ${m.from_email ?? ""} on ${new Date(m.received_at).toISOString().slice(0, 19)}Z`;
    const finalDescription = [caption, description].filter(Boolean).join("\n\n");

    const { data: event, error: insertErr } = await admin
      .from("calendar_events")
      .insert({
        case_id: m.case_id,
        created_by: user.id,
        title,
        description: finalDescription,
        event_type: eventType,
        child_id: childId,
        start_time: startIso,
        end_time: endIso,
        all_day: false,
        source: "email",
        source_message_id: messageId,
        visibility,
      })
      .select("id")
      .single();

    if (insertErr) return NextResponse.json({ error: insertErr.message }, { status: 500 });

    await admin.from("calendar_inbox_messages").update({ created_event_id: event.id, parse_status: "parsed" }).eq("id", messageId);
    await admin.from("calendar_event_attachments").insert({
      event_id: event.id,
      attachment_type: m.source,
      inbox_message_id: messageId,
      content_text: m.body_text?.slice(0, 2000),
    });

    return NextResponse.json({ event_id: event.id });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Failed" }, { status: 500 });
  }
}
