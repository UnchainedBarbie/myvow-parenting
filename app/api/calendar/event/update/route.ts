import { NextRequest, NextResponse } from "next/server";
import { createClient, getServiceRoleClient } from "@/lib/supabase/server";

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
    const { event_id, history, status, ...rest } = body;

    if (!event_id) {
      return NextResponse.json(
        { error: "Missing event_id" },
        { status: 400 }
      );
    }

    const admin = getServiceRoleClient();

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

    // Insert history entries if provided
    if (Array.isArray(history) && history.length > 0) {
      const rows = history.map((h: any) => ({
        event_id,
        field_name: h.field_changed,
        old_value: h.old_value ?? null,
        new_value: h.new_value ?? null,
        note: h.note ?? null,
        changed_by: user.id,
      }));
      const { error: historyError } = await admin
        .from("calendar_event_history")
        .insert(rows);
      if (historyError) {
        return NextResponse.json(
          {
            error:
              historyError.message || "Failed to record event history",
          },
          { status: 500 }
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

    return NextResponse.json({ event: updatedEvent }, { status: 200 });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Update failed" },
      { status: 500 }
    );
  }
}

