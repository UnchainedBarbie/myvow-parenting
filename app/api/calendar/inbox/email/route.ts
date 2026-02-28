import { NextRequest, NextResponse } from "next/server";
import { getServiceRoleClient } from "@/lib/supabase/server";
import { parseEmailBody } from "@/lib/calendar/parse-email";

/**
 * Inbound email webhook (SendGrid Inbound Parse / Mailgun Routes).
 * Expects: from, to, subject, text (or body). Stores as inbox message, parses, optionally creates event.
 * Verify with CALENDAR_INBOUND_WEBHOOK_SECRET if set (e.g. ?secret=xxx or header).
 */
export async function POST(request: NextRequest) {
  try {
    const secret = request.nextUrl.searchParams.get("secret") ?? request.headers.get("x-webhook-secret") ?? "";
    const envSecret = process.env.CALENDAR_INBOUND_WEBHOOK_SECRET;
    if (envSecret && envSecret.length > 0 && secret !== envSecret) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    let from = "";
    let to = "";
    let subject = "";
    let text = "";
    let html: string | null = null;

    const contentType = request.headers.get("content-type") ?? "";
    if (contentType.includes("application/json")) {
      const body = await request.json();
      from = body.from ?? body.sender ?? "";
      to = body.to ?? body.recipient ?? "";
      subject = body.subject ?? "";
      text = body.text ?? body.body ?? body.plain ?? "";
      html = body.html ?? null;
    } else {
      const formData = await request.formData();
      from = (formData.get("from") as string) ?? (formData.get("sender") as string) ?? "";
      to = (formData.get("to") as string) ?? (formData.get("recipient") as string) ?? "";
      subject = (formData.get("subject") as string) ?? "";
      text = (formData.get("text") as string) ?? (formData.get("body") as string) ?? (formData.get("plain") as string) ?? "";
      const h = formData.get("html");
      html = typeof h === "string" ? h : null;
    }

    to = (to.split(",")[0] ?? to).trim().toLowerCase();
    from = (from.replace(/^.*<([^>]+)>$/, "$1").trim() || from).toLowerCase();

    if (!to) {
      return NextResponse.json({ error: "Missing to address" }, { status: 400 });
    }

    const admin = getServiceRoleClient();

    const { data: userRow } = await admin
      .from("users")
      .select("id")
      .eq("calendar_inbox_email", to)
      .maybeSingle();

    if (!userRow) {
      return NextResponse.json({ error: "Unknown inbox address" }, { status: 404 });
    }

    const userId = userRow.id;
    const { data: membership } = await admin
      .from("case_members")
      .select("case_id")
      .eq("user_id", userId)
      .limit(1)
      .maybeSingle();
    const caseId = membership?.case_id ?? null;
    if (!caseId) {
      return NextResponse.json({ error: "User has no case" }, { status: 400 });
    }

    const parsed = parseEmailBody(subject, text);
    const parseStatus = parsed.confidence >= 0.75 ? "parsed" : "needs_review";
    const parseError = null;

    const parsedStartIso = parsed.date && parsed.start_time ? new Date(`${parsed.date}T${parsed.start_time}:00`).toISOString() : null;
    const parsedEndIso = parsed.date && parsed.end_time ? new Date(`${parsed.date}T${parsed.end_time}:00`).toISOString() : null;

    const { data: msg, error: insertErr } = await admin
      .from("calendar_inbox_messages")
      .insert({
        user_id: userId,
        case_id: caseId,
        source: "email",
        from_email: from,
        to_email: to,
        subject,
        body_text: text.slice(0, 50000),
        body_html: html ? html.slice(0, 100000) : null,
        raw_payload_json: { from, to, subject, textLength: text.length },
        parse_status: parseStatus,
        parse_error: parseError,
        parsed_title: parsed.title,
        parsed_date: parsed.date,
        parsed_start_time: parsedStartIso,
        parsed_end_time: parsedEndIso,
        parsed_notes: parsed.notes,
        parsed_category: parsed.category,
        parsed_visibility: parsed.visibility,
        parse_confidence: parsed.confidence,
      })
      .select("id")
      .single();

    if (insertErr) {
      return NextResponse.json({ error: insertErr.message }, { status: 500 });
    }

    let createdEventId: string | null = null;
    if (parseStatus === "parsed" && parsed.date && parsed.start_time) {
      const tz = "America/Denver";
      const startIso = new Date(`${parsed.date}T${parsed.start_time}:00`).toISOString();
      const endIso = parsed.end_time
        ? new Date(`${parsed.date}T${parsed.end_time}:00`).toISOString()
        : null;
      const descriptionParts = [
        `Captured via email from ${from} on ${new Date().toISOString().slice(0, 19)}Z`,
        parsed.notes,
      ].filter(Boolean);
      const { data: childRow } = parsed.child_name
        ? await admin
            .from("children")
            .select("id")
            .eq("case_id", caseId)
            .ilike("first_name", parsed.child_name)
            .limit(1)
            .maybeSingle()
        : { data: null };
      const childId = childRow?.id ?? null;

      const { data: event, error: eventErr } = await admin
        .from("calendar_events")
        .insert({
          case_id: caseId,
          created_by: userId,
          title: parsed.title,
          description: descriptionParts.join("\n\n"),
          event_type: parsed.category,
          child_id: childId,
          start_time: startIso,
          end_time: endIso,
          all_day: false,
          source: "email",
          source_message_id: msg.id,
          visibility: parsed.visibility,
        })
        .select("id")
        .single();

      if (!eventErr && event) {
        createdEventId = event.id;
        await admin
          .from("calendar_inbox_messages")
          .update({ created_event_id: event.id })
          .eq("id", msg.id);
        await admin.from("calendar_event_attachments").insert({
          event_id: event.id,
          attachment_type: "email",
          inbox_message_id: msg.id,
          content_text: text.slice(0, 2000),
        });
      }
    }

    return NextResponse.json({ ok: true, message_id: msg.id, event_id: createdEventId }, { status: 200 });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Webhook failed" },
      { status: 500 }
    );
  }
}
