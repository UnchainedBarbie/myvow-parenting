import { NextRequest, NextResponse } from "next/server";
import { createClient, getServiceRoleClient } from "@/lib/supabase/server";
import { effectiveNotifyCoparent } from "@/lib/calendar/coparent-notice";
import { saveCalendarCoparentNotice } from "@/lib/calendar/save-coparent-notice";

export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body: any = await request.json();
    const { event_id, history, status, notify_coparent, ...rest } = body;

    if (!event_id) {
      return NextResponse.json(
        { error: "Missing event_id" },
        { status: 400 }
      );
    }

    const admin = getServiceRoleClient();
    const { data: before } = await admin
      .from("calendar_events")
      .select("id, case_id, title, description, start_time, end_time, visibility")
      .eq("id", event_id)
      .maybeSingle();

    // Build updates directly from provided fields
    const updates: Record<string, unknown> = {};
    const allowedFields = [
      "title",
      "description",
      "event_type",
      "child_id",
      "visibility",
      "kid_title",
      "actual_exchange_time",
      "transported_by",
      "exchange_location",
      "child_condition_notes",
      "start_time",
      "end_time",
      "all_day",
      "recurring_rule",
      "deleted_at",
    ];

    for (const key of allowedFields) {
      if (Object.prototype.hasOwnProperty.call(rest, key)) {
        const value = rest[key];
        if (value !== undefined) {
          updates[key] = value;
        }
      }
    }

    // Map status -> status column if provided (not swap_status)
    if (status !== undefined) {
      updates.status = status;
    }

    // Apply updates and return updated row
    let updatedEvent = null;
    if (Object.keys(updates).length > 0) {
      // Debug: log update payload
      // eslint-disable-next-line no-console
      console.log(
        "[calendar/event/update] updating event_id",
        event_id,
        "with fields",
        updates
      );
      try {
        const { data, error } = await admin
          .from("calendar_events")
          .update(updates)
          .eq("id", event_id)
          .select("*")
          .single();

        if (error) {
          // eslint-disable-next-line no-console
          console.log(
            "[calendar/event/update] FULL ERROR:",
            JSON.stringify(error, null, 2)
          );
          return NextResponse.json(
            { error: error.message || "Update failed" },
            { status: 500 }
          );
        }
        if (!data) {
          return NextResponse.json(
            { error: "Event not found" },
            { status: 404 }
          );
        }
        updatedEvent = data;
      } catch (error) {
        // eslint-disable-next-line no-console
        console.log(
          "[calendar/event/update] EXCEPTION:",
          JSON.stringify(error, null, 2)
        );
        return NextResponse.json(
          { error: "Update failed" },
          { status: 500 }
        );
      }
    }

    // Insert history entries if provided (non-blocking: event save succeeds even if this fails)
    let historyRecorded = true;
    if (Array.isArray(history) && history.length > 0) {
      const rows = history.map((h: any) => ({
        event_id,
        field_changed: h.field_changed,
        old_value: h.old_value ?? null,
        new_value: h.new_value ?? null,
        note: h.note ?? null,
        changed_by: user.id,
      }));
      const { error: historyError } = await admin
        .from("calendar_event_history")
        .insert(rows);
      if (historyError) {
        historyRecorded = false;
        // eslint-disable-next-line no-console
        console.warn(
          "[calendar/event/update] history insert failed:",
          historyError.message
        );
      }
    }

    // If nothing was updated (only history), fetch the event to return it
    if (!updatedEvent) {
      const { data, error } = await admin
        .from("calendar_events")
        .select("*")
        .eq("id", event_id)
        .single();
      if (error || !data) {
        return NextResponse.json(
          { error: "Event not found" },
          { status: 404 }
        );
      }
      updatedEvent = data;
    }

    const saved = updatedEvent as {
      id?: string;
      case_id?: string;
      title?: string | null;
      description?: string | null;
      start_time?: string | null;
      end_time?: string | null;
      visibility?: string | null;
    };
    const caseId = saved.case_id || (before as { case_id?: string } | null)?.case_id || "";
    const savedDescription = typeof saved.description === "string" ? saved.description : null;
    const privateRecord = Boolean(savedDescription?.startsWith("[PRIVATE]"));
    const visibility = (privateRecord
      ? "private"
      : saved.visibility || (before as { visibility?: string } | null)?.visibility || "family") as
      | "family"
      | "parents_only"
      | "just_me_and_kids"
      | "private";
    const askedAboutCoparent = typeof notify_coparent === "boolean";
    let notice: Awaited<ReturnType<typeof saveCalendarCoparentNotice>> | null = null;
    if (caseId && askedAboutCoparent) {
      try {
        notice = await saveCalendarCoparentNotice(admin, {
          caseId,
          eventId: event_id,
          actorId: user.id,
          visibility,
          notify: effectiveNotifyCoparent(
            visibility,
            typeof notify_coparent === "boolean" ? notify_coparent : null
          ),
          kind: "updated",
          title: typeof saved.title === "string" ? saved.title : "",
          start: typeof saved.start_time === "string" ? saved.start_time : null,
          end: typeof saved.end_time === "string" ? saved.end_time : null,
          description: privateRecord ? null : savedDescription,
          allDay: (saved as { all_day?: boolean }).all_day === true,
          previous: before
            ? {
                title: (before as { title?: string | null }).title,
                start: (before as { start_time?: string | null }).start_time,
                end: (before as { end_time?: string | null }).end_time,
                description: (before as { description?: string | null }).description,
              }
            : null,
        });
      } catch (noticeError) {
        console.error(
          "[calendar/notice]",
          noticeError instanceof Error ? noticeError.message : "notice failed"
        );
      }
    }

    return NextResponse.json(
      {
        event: updatedEvent,
        ...(notice
          ? {
              coparent_notice: notice.status,
              coparent_pending_invite: notice.pendingInvite,
            }
          : {}),
        ...(historyRecorded === false && {
          warning: "Event saved, but history could not be recorded.",
        }),
      },
      { status: 200 }
    );
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Update failed" },
      { status: 500 }
    );
  }
}

