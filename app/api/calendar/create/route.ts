import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getServiceRoleClient } from "@/lib/supabase/server";

/**
 * Create calendar event. Service role for writes.
 */
export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
    }
    const body = await request.json();
    const {
      case_id,
      title,
      description,
      event_type,
      child_id,
      start_time,
      end_time,
      all_day,
      is_private,
      recurring_rule,
      kid_title,
      visibility,
      source,
      source_message_id,
    } = body as {
      case_id?: string;
      title?: string;
      description?: string;
      event_type?: string;
      child_id?: string;
      start_time?: string;
      end_time?: string;
      all_day?: boolean;
      is_private?: boolean;
      recurring_rule?: string;
      kid_title?: string;
      visibility?: "family" | "parents_only" | "just_me_and_kids" | "private";
      source?: "manual" | "email" | "photo";
      source_message_id?: string;
    };
    if (!case_id || !title || !start_time) {
      return NextResponse.json(
        { message: "Missing case_id, title, or start_time" },
        { status: 400 }
      );
    }
    const admin = getServiceRoleClient();
    const visibilityValue: "family" | "parents_only" | "just_me_and_kids" | "private" =
      visibility ?? "family";
    const privateFlag =
      visibilityValue === "private" || (!!is_private && !visibility);
    const descriptionValue =
      description && description.trim().length > 0
        ? description.trim()
        : null;
    const storedDescription = privateFlag
      ? [`[PRIVATE]`, descriptionValue].filter(Boolean).join(" ")
      : descriptionValue;

    const insertPayload: Record<string, unknown> = {
      case_id,
      created_by: user.id,
      title,
      description: storedDescription,
      event_type: event_type ?? null,
      child_id: child_id ?? null,
      start_time,
      end_time: end_time ?? null,
      all_day: all_day ?? false,
      recurring_rule: recurring_rule ?? null,
      visibility: visibilityValue,
      kid_title: kid_title ?? null,
    };
    if (source) insertPayload.source = source;
    if (source_message_id) insertPayload.source_message_id = source_message_id;

    const { data: event, error } = await admin
      .from("calendar_events")
      .insert(insertPayload)
      .select("id")
      .single();
    if (error) {
      return NextResponse.json(
        { message: error.message },
        { status: 500 }
      );
    }

    if (source_message_id) {
      await admin.from("calendar_inbox_messages").update({ created_event_id: event.id, parse_status: "parsed" }).eq("id", source_message_id);
      const { data: inboxRow } = await admin.from("calendar_inbox_messages").select("source, raw_payload_json, body_text").eq("id", source_message_id).single();
      const payload = (inboxRow as any)?.raw_payload_json ?? {};
      await admin.from("calendar_event_attachments").insert({
        event_id: event.id,
        attachment_type: (inboxRow as any)?.source ?? "photo",
        inbox_message_id: source_message_id,
        storage_path: payload.storage_path ?? null,
        content_text: (inboxRow as any)?.body_text?.slice(0, 2000) ?? null,
      });
    }

    // Best-effort: record initial "Event created" history entry.
    try {
      await admin.from("calendar_event_history").insert({
        event_id: event.id,
        field_changed: "created",
        new_value: "Event created",
        note: null,
        changed_by: user.id,
      });
    } catch {
      // Ignore history failures so event creation is not blocked.
    }

    // Attempt to store a notification record when creating a shared event and a co-parent exists.
    if (!privateFlag) {
      const { data: members } = await admin
        .from("case_members")
        .select("user_id, is_participating, external_email")
        .eq("case_id", case_id)
        .neq("user_id", user.id);

      const recipients =
        members?.filter(
          (m: any) =>
            m.user_id &&
            (m.is_participating ?? true) &&
            !m.external_email
        ) ?? [];

      if (recipients.length > 0) {
        const notificationPayload = recipients.map((m: any) => ({
          case_id,
          event_id: event.id,
          recipient_user_id: m.user_id,
          type: "event_created",
        }));
        const { error: notifError }: any = await admin
          .from("calendar_notifications")
          .insert(notificationPayload);

        // Ignore if the notifications table does not exist; surface other errors.
        if (notifError && notifError.code && notifError.code !== "42P01") {
          return NextResponse.json(
            { message: notifError.message || "Notification insert failed" },
            { status: 500 }
          );
        }
      }
    }

    return NextResponse.json({ event_id: event.id });
  } catch (e) {
    return NextResponse.json(
      { message: e instanceof Error ? e.message : "Create failed" },
      { status: 500 }
    );
  }
}
