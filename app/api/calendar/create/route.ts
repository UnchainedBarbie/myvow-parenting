import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getServiceRoleClient } from "@/lib/supabase/server";
import { saveCalendarCoparentNotice } from "@/lib/calendar/save-coparent-notice";
import { effectiveNotifyCoparent } from "@/lib/calendar/coparent-notice";

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
      notify_coparent,
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
      notify_coparent?: boolean;
    };
    const titleValue = typeof title === "string" ? title.trim() : "";
    const startValue = typeof start_time === "string" ? start_time.trim() : "";
    if (!case_id || !titleValue || !startValue || Number.isNaN(Date.parse(startValue))) {
      return NextResponse.json(
        { message: "Title, date, and start time are required." },
        { status: 400 }
      );
    }
    const admin = getServiceRoleClient();
    const visibilityValue: "family" | "parents_only" | "just_me_and_kids" | "private" =
      visibility ?? "family";
    const privateFlag =
      visibilityValue === "private" || (!!is_private && !visibility);
    const descriptionValue =
      typeof description === "string" && description.trim().length > 0
        ? description.trim()
        : null;
    const storedDescription = privateFlag
      ? [`[PRIVATE]`, descriptionValue].filter(Boolean).join(" ")
      : descriptionValue;

    const insertPayload: Record<string, unknown> = {
      case_id,
      created_by: user.id,
      title: titleValue,
      description: storedDescription,
      event_type: event_type ?? null,
      child_id: child_id ?? null,
      start_time: startValue,
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

    const noticeVisibility = privateFlag ? "private" : visibilityValue;
    let notice: Awaited<ReturnType<typeof saveCalendarCoparentNotice>> = {
      status: "skipped",
      pendingInvite: false,
    };
    try {
      notice = await saveCalendarCoparentNotice(admin, {
      caseId: case_id,
      eventId: event.id,
      actorId: user.id,
      visibility: noticeVisibility,
      notify: effectiveNotifyCoparent(
        noticeVisibility,
        typeof notify_coparent === "boolean" ? notify_coparent : null
      ),
      kind: "created",
      title: titleValue,
      start: startValue,
      end: typeof end_time === "string" ? end_time : null,
      description: privateFlag ? null : descriptionValue,
      allDay: all_day === true,
    });
    } catch (noticeError) {
      console.error(
        "[calendar/notice]",
        noticeError instanceof Error ? noticeError.message : "notice failed"
      );
    }

    return NextResponse.json({
      event_id: event.id,
      coparent_notice: notice.status,
      coparent_pending_invite: notice.pendingInvite,
    });
  } catch (e) {
    return NextResponse.json(
      { message: e instanceof Error ? e.message : "Create failed" },
      { status: 500 }
    );
  }
}
